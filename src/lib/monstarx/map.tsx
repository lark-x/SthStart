// An interactive map you can pan, zoom and drop pins on — with no API key.
//
// MonstarX apps get their basemap from OpenFreeMap (OpenStreetMap data, no registration, no key, no
// request limits, commercial use allowed). Nothing has to be connected for a map to work, and the
// attribution the licence asks for is added by the map itself.
//
// When the Mapbox connector is connected, the same component uses Mapbox's styles instead — including
// satellite — without a single change to the app's code. Nothing else is different.
//
// For "pick a country" or "colour the world by a number", use <WorldMap> from ./world: it needs no
// network and no WebGL, so it also renders in a screenshot.

import { useEffect, useId, useRef, useState } from 'react'
import { getPublicEnv } from '../config'

export interface LatLon {
  lat: number
  lon: number
}

export interface MapMarker extends LatLon {
  /** Stable id, so a marker is moved rather than recreated when the list changes. Defaults to its position. */
  id?: string
  /** Shown in a popup when the pin is clicked, and read out to screen readers. */
  label?: string
  /** Any CSS colour. Defaults to the map's accent. */
  color?: string
}

/** The basemaps every app can use without connecting anything. */
export type MapStyle = 'streets' | 'light' | 'dark' | 'terrain' | 'satellite'

export interface MapProps {
  /** Where the map opens. Defaults to a view of the whole world. */
  center?: LatLon
  /** 0 is the whole world, 3 a continent, 10 a city, 15 a street. Defaults to 1, or 9 with a center. */
  zoom?: number
  /** Which basemap to draw. 'satellite' needs the Mapbox connector; without it the map stays on 'terrain'. */
  style?: MapStyle | (string & {})
  markers?: readonly MapMarker[]
  onMarkerClick?: (marker: MapMarker) => void
  /** Called with the position of a click on the map itself. */
  onMapClick?: (position: LatLon) => void
  /** Called after the user finishes panning or zooming. */
  onMove?: (view: LatLon & { zoom: number }) => void
  /** Frame the map on these points instead of center/zoom — e.g. every marker. */
  fit?: readonly LatLon[]
  /** false draws a still map: no dragging, no scroll-zoom, no controls. Default true. */
  interactive?: boolean
  /** Show the zoom and compass buttons. Default true when interactive. */
  controls?: boolean
  /** Sets the size. A map needs a height, so this defaults to `h-96 w-full`. */
  className?: string
  /** Drawn over the map (a legend, a search box, a card). Clicks on it do not reach the map. */
  children?: React.ReactNode
}

/** The keyless OpenFreeMap styles, by the names this component takes. */
const FREE_STYLES: Record<string, string> = {
  streets: 'https://tiles.openfreemap.org/styles/bright',
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
  terrain: 'https://tiles.openfreemap.org/styles/liberty',
  // OpenFreeMap has no imagery, so a satellite map without Mapbox falls back to the most detailed style.
  satellite: 'https://tiles.openfreemap.org/styles/liberty',
}

const MAPBOX_STYLES: Record<string, string> = {
  streets: 'mapbox://styles/mapbox/streets-v12',
  light: 'mapbox://styles/mapbox/light-v11',
  dark: 'mapbox://styles/mapbox/dark-v11',
  terrain: 'mapbox://styles/mapbox/outdoors-v12',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
}

/** getPublicEnv() once per page, shared by every map on it. */
let publicEnvPromise: Promise<Record<string, string>> | null = null
function loadPublicEnv(): Promise<Record<string, string>> {
  publicEnvPromise ??= getPublicEnv().catch(() => ({}) as Record<string, string>)
  return publicEnvPromise
}

/** A style name resolves against Mapbox when its token is there, and against OpenFreeMap otherwise. */
function resolveStyle(style: string, mapboxToken: string | undefined): string {
  if (style.startsWith('http') || style.startsWith('mapbox://')) return style
  if (mapboxToken && MAPBOX_STYLES[style]) return MAPBOX_STYLES[style]!
  return FREE_STYLES[style] ?? FREE_STYLES.streets!
}

/** WebGL is what draws the map. It is there in every normal browser, but not in every screenshot tool. */
function hasWebGL(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

const markerKey = (marker: MapMarker) => marker.id ?? `${marker.lat},${marker.lon}`

type MapLibre = typeof import('maplibre-gl')
type MapInstance = import('maplibre-gl').Map
type MarkerInstance = import('maplibre-gl').Marker

/**
 * maplibre-gl is ~300 KB: it is fetched the first time a map is shown, never on pages without one.
 * The `import.meta.env.SSR` guard is replaced by a literal at build time, so the whole library is also
 * dropped from the server bundle instead of riding along in every deployed Worker.
 */
let libraryPromise: Promise<MapLibre> | null = null
function loadLibrary(): Promise<MapLibre> {
  if (import.meta.env.SSR) return Promise.reject(new Error('The map is only drawn in the browser'))
  libraryPromise ??= Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl.css'),
    // Vite must bundle the worker and its shared module; MapLibre's default sibling URL is not emitted.
    import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
  ]).then(([library, , worker]) => {
    library.setWorkerUrl(worker.default)
    return library
  })
  return libraryPromise
}

/**
 * A pannable, zoomable map.
 *
 * ```tsx
 * <Map center={{ lat: 35.68, lon: 139.69 }} zoom={10} markers={offices} onMarkerClick={open} />
 * ```
 *
 * The map is client-side: it renders a placeholder on the server and takes over once the page is
 * interactive, so a page with a map still server-renders normally.
 */
export function Map({
  center,
  zoom,
  style = 'streets',
  markers,
  onMarkerClick,
  onMapClick,
  onMove,
  fit,
  interactive = true,
  controls,
  className,
  children,
}: MapProps) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapInstance | null>(null)
  const markerRefs = useRef<globalThis.Map<string, MarkerInstance>>(new globalThis.Map())
  const libraryRef = useRef<MapLibre | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unsupported' | 'failed'>('loading')
  const labelId = useId()

  // Handlers change on every render of the page above; the map is built once, so it reads them from a ref.
  const handlers = useRef({ onMarkerClick, onMapClick, onMove })
  handlers.current = { onMarkerClick, onMapClick, onMove }

  const startCenter: [number, number] = [center?.lon ?? 0, center?.lat ?? 20]
  const startZoom = zoom ?? (center ? 9 : 1)

  // Build the map once. Everything after this is an update on the live instance, so panning and
  // zooming are never thrown away by a re-render of the page.
  useEffect(() => {
    if (!container.current) return
    if (!hasWebGL()) {
      setState('unsupported')
      return
    }
    let cancelled = false

    void (async () => {
      try {
        const [maplibregl, env] = await Promise.all([loadLibrary(), loadPublicEnv()])
        if (cancelled || !container.current) return
        libraryRef.current = maplibregl
        const token = env.PUBLIC_MAPBOX_ACCESS_TOKEN
        const map = new maplibregl.Map({
          container: container.current,
          style: resolveStyle(style, token),
          center: startCenter,
          zoom: startZoom,
          interactive,
          attributionControl: { compact: true },
          // A software renderer is slow but correct; refusing to draw would leave an empty box.
          canvasContextAttributes: { failIfMajorPerformanceCaveat: false },
          // Mapbox styles are fetched with the public token; OpenFreeMap styles never see it.
          transformRequest: token
            ? (url: string) => {
                if (!url.startsWith('https://api.mapbox.com/')) return { url }
                return { url: url + (url.includes('?') ? '&' : '?') + `access_token=${token}` }
              }
            : undefined,
        })
        if (cancelled) {
          map.remove()
          return
        }
        mapRef.current = map
        if (interactive && controls !== false) {
          map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right')
        }
        map.on('click', (event) => {
          handlers.current.onMapClick?.({ lat: event.lngLat.lat, lon: event.lngLat.lng })
        })
        map.on('moveend', () => {
          const c = map.getCenter()
          handlers.current.onMove?.({ lat: c.lat, lon: c.lng, zoom: map.getZoom() })
        })
        map.on('error', (event) => {
          // A single tile that will not load must not blank the map; a broken style must not be silent.
          if (event.error?.message?.includes('Worker failed to load')) setState('failed')
          if (import.meta.env?.DEV) console.warn('[map]', event.error?.message ?? event)
        })
        map.once('load', () => !cancelled && setState('ready'))
      } catch (error) {
        if (!cancelled) {
          console.error('[map] could not start', error)
          setState('failed')
        }
      }
    })()

    return () => {
      cancelled = true
      for (const marker of markerRefs.current.values()) marker.remove()
      markerRefs.current.clear()
      mapRef.current?.remove()
      mapRef.current = null
    }
    // Built once: the props below are applied by the effects that follow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Style changes swap the basemap in place.
  useEffect(() => {
    const map = mapRef.current
    if (!map || state !== 'ready') return
    void loadPublicEnv().then((env) => {
      if (mapRef.current === map) map.setStyle(resolveStyle(style, env.PUBLIC_MAPBOX_ACCESS_TOKEN))
    })
  }, [state, style])

  // center/zoom from props: move the map when the page asks for a different view.
  useEffect(() => {
    const map = mapRef.current
    if (!map || state !== 'ready' || fit?.length || !center) return
    map.easeTo({ center: [center.lon, center.lat], zoom: zoom ?? map.getZoom(), duration: 600 })
  }, [center?.lat, center?.lon, zoom, fit?.length, state]) // eslint-disable-line react-hooks/exhaustive-deps

  // fit: frame every point, with a sensible zoom when there is only one.
  useEffect(() => {
    const map = mapRef.current
    const maplibregl = libraryRef.current
    if (!map || !maplibregl || state !== 'ready' || !fit?.length) return
    if (fit.length === 1) {
      map.easeTo({ center: [fit[0]!.lon, fit[0]!.lat], zoom: Math.max(map.getZoom(), 9), duration: 600 })
      return
    }
    const bounds = new maplibregl.LngLatBounds()
    for (const point of fit) bounds.extend([point.lon, point.lat])
    map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 600 })
  }, [fit, state])

  // Markers: add, move and remove without rebuilding the ones that did not change.
  useEffect(() => {
    const map = mapRef.current
    const maplibregl = libraryRef.current
    if (!map || !maplibregl || state !== 'ready') return
    const wanted = markers ?? []
    const live = markerRefs.current
    const keys = new Set(wanted.map(markerKey))
    for (const [key, marker] of live) {
      if (!keys.has(key)) {
        marker.remove()
        live.delete(key)
      }
    }
    for (const marker of wanted) {
      const key = markerKey(marker)
      const existing = live.get(key)
      if (existing) {
        existing.setLngLat([marker.lon, marker.lat])
        continue
      }
      const pin = new maplibregl.Marker({ color: marker.color ?? '#1d4ed8' }).setLngLat([marker.lon, marker.lat])
      if (marker.label) {
        pin.setPopup(new maplibregl.Popup({ offset: 24, closeButton: false }).setText(marker.label))
        pin.getElement().setAttribute('aria-label', marker.label)
      }
      pin.getElement().style.cursor = 'pointer'
      pin.getElement().addEventListener('click', () => handlers.current.onMarkerClick?.(marker))
      pin.addTo(map)
      live.set(key, pin)
    }
  }, [markers, state])

  // The map only knows its size when it is drawn; a card that opens, a tab that shows or a window
  // that changes would otherwise leave it stretched.
  useEffect(() => {
    const element = container.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => mapRef.current?.resize())
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const box = className ?? 'h-96 w-full'
  const unavailable = state === 'unsupported' || state === 'failed'

  return (
    <div className={`relative overflow-hidden rounded-lg ${box}`} aria-describedby={labelId}>
      {/* maplibre-gl's own stylesheet sets `.maplibregl-map { position: relative }`, which would beat an
          `absolute inset-0` here and collapse the map to no height — so the container fills the box instead. */}
      <div ref={container} className="h-full w-full" />
      {state === 'loading' ? (
        <div className="absolute inset-0 animate-pulse bg-slate-100" aria-hidden />
      ) : null}
      {unavailable ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-100 p-4 text-center">
          <p className="text-sm font-medium text-slate-700">The map could not be displayed</p>
          <p className="text-xs text-slate-500">
            {state === 'unsupported'
              ? 'This browser has no WebGL, which interactive maps need.'
              : 'The map could not be loaded. Please check your connection and try again.'}
          </p>
        </div>
      ) : null}
      <span id={labelId} className="sr-only">
        Interactive map
      </span>
      {children}
    </div>
  )
}

export { COUNTRIES, countryByCode, findCountry, searchCountries, countriesIn, distanceKm } from './countries'
export type { Country } from './countries'
