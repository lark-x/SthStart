// A world map you can click, with no map provider, no API key and no WebGL.
//
// This is the right component for "pick a country", "colour the world by a number" and "show where these
// things are" — the map is drawn from country outlines that ship with the app (Natural Earth, public
// domain), so it renders on the server, in a screenshot and offline, and it never calls anyone.
//
// For a street-level map you can pan and zoom — addresses, routes, "near me" — use <Map> from
// ./map instead. The two work together: <WorldMap> to choose a country, <Map> to look inside it.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { COUNTRIES, countryByCode, countryName, type Country } from './countries'

/** A ring of [longitude, latitude] pairs. */
type Ring = [number, number][]
type Shapes = Record<string, Ring[]>

export type Projection = 'natural' | 'equirectangular' | 'mercator'

export interface WorldMapMarker {
  lat: number
  lon: number
  /** Read out to screen readers and shown on hover. */
  label?: string
  /** Any CSS colour. Defaults to the map's accent colour. */
  color?: string
  /** Radius in SVG units (the map is ~1000 wide). Defaults to 6. */
  size?: number
  onClick?: () => void
}

export interface WorldMapColors {
  /** Countries with no value of their own. */
  land?: string
  /** The outline between countries. */
  border?: string
  /** Under the land. */
  water?: string
  /** Hover and focus. */
  hover?: string
  /** The selected country. */
  selected?: string
  /** Low → high ends of the `values` scale. */
  scale?: [string, string]
  /** Markers, and the default accent. */
  accent?: string
}

export interface WorldMapProps {
  /** Colour countries by a number, keyed by ISO alpha-2 code: `{ JP: 42, BR: 17 }`. */
  values?: Record<string, number>
  /** The ISO alpha-2 code of the country drawn as selected. */
  selected?: string | null
  /** Called when a country is clicked or chosen with the keyboard; null when the selection is cleared. */
  onSelect?: (country: Country | null) => void
  /** Countries to draw in the accent colour regardless of `values`, by ISO alpha-2 code. */
  highlight?: readonly string[]
  /** Countries that cannot be chosen (drawn muted, not focusable). */
  disabled?: readonly string[]
  /** Points drawn on top of the map. */
  markers?: readonly WorldMapMarker[];
  /** How the globe is flattened. 'natural' (the default) looks like an atlas; 'mercator' matches street maps. */
  projection?: Projection
  /** Frame the map on one country (ISO alpha-2), a UN region ('Europe'), or an explicit box. */
  focus?: string | { minLat: number; maxLat: number; minLon: number; maxLon: number } | null
  /** Show the country name (and its value) while hovering. Default true. */
  tooltip?: boolean
  /** What the tooltip says. Defaults to the name, plus the value when there is one. */
  formatTooltip?: (country: Country, value: number | undefined) => string
  colors?: WorldMapColors
  /** Describes the map to screen readers. */
  ariaLabel?: string
  className?: string
  /** Rendered over the map, e.g. a legend or a caption. */
  children?: React.ReactNode
}

const DEFAULT_COLORS: Required<Omit<WorldMapColors, 'scale'>> & { scale: [string, string] } = {
  land: '#e2e8f0',
  border: '#ffffff',
  water: 'transparent',
  hover: '#94a3b8',
  selected: '#1d4ed8',
  scale: ['#dbeafe', '#1d4ed8'],
  accent: '#1d4ed8',
}

const VIEW_WIDTH = 1000

/** Natural Earth projection (Tom Patterson): the atlas look, without the poles filling the page. */
function naturalEarth(lon: number, lat: number): [number, number] {
  const phi = (lat * Math.PI) / 180
  const lambda = (lon * Math.PI) / 180
  const phi2 = phi * phi
  const phi4 = phi2 * phi2
  const x = lambda * (0.8707 - 0.131979 * phi2 + phi4 * (-0.013791 + phi4 * (0.003971 * phi2 - 0.001529 * phi2 * phi2)))
  const y = phi * (1.007226 + phi2 * (0.015085 + phi4 * (-0.044475 + 0.028874 * phi2 - 0.005916 * phi4)))
  return [x, y]
}

function project(projection: Projection, lon: number, lat: number): [number, number] {
  if (projection === 'equirectangular') return [(lon * Math.PI) / 180, (lat * Math.PI) / 180]
  if (projection === 'mercator') {
    // Clamp near the poles: Mercator sends them to infinity.
    const phi = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180
    return [(lon * Math.PI) / 180, Math.log(Math.tan(Math.PI / 4 + phi / 2))]
  }
  return naturalEarth(lon, lat)
}

/** The whole projected world, so every projection fills the same box. */
function worldExtent(projection: Projection) {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let lon = -180; lon <= 180; lon += 5) {
    for (let lat = -90; lat <= 90; lat += 5) {
      const [x, y] = project(projection, lon, lat)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return { minX, maxX, minY, maxY }
}

/** Projected degrees → SVG units, y flipped so north is up. */
function makeTransform(projection: Projection) {
  const { minX, maxX, minY, maxY } = worldExtent(projection)
  const scale = VIEW_WIDTH / (maxX - minX)
  const height = (maxY - minY) * scale
  return {
    height,
    point(lon: number, lat: number): [number, number] {
      const [x, y] = project(projection, lon, lat)
      return [(x - minX) * scale, height - (y - minY) * scale]
    },
  }
}

function pathFor(rings: Ring[], point: (lon: number, lat: number) => [number, number]): string {
  let d = ''
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [x, y] = point(ring[i]![0], ring[i]![1])
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    }
    d += 'Z'
  }
  return d
}

function mix(from: string, to: string, t: number): string {
  const parse = (hex: string) => {
    const value = hex.replace('#', '')
    const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
  }
  if (!from.startsWith('#') || !to.startsWith('#')) return t > 0.5 ? to : from
  const a = parse(from)
  const b = parse(to)
  const channel = (i: number) => Math.round(a[i]! + (b[i]! - a[i]!) * Math.max(0, Math.min(1, t)))
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`
}

/** The country outlines, fetched once per page and shared by every <WorldMap> on it. */
let shapesPromise: Promise<Shapes> | null = null
function loadShapes(): Promise<Shapes> {
  shapesPromise ??= import('./world-shapes').then((module) => module.default as unknown as Shapes)
  return shapesPromise
}

function boundsOfRings(rings: Ring[]) {
  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lon < minLon) minLon = lon
      if (lon > maxLon) maxLon = lon
    }
  }
  return { minLat, maxLat, minLon, maxLon }
}

/**
 * A clickable map of the world.
 *
 * ```tsx
 * const [country, setCountry] = useState<Country | null>(null)
 * <WorldMap selected={country?.code} onSelect={setCountry} values={storyCounts} />
 * ```
 *
 * It renders immediately with the ocean and the frame, then fills in the countries as soon as the
 * outlines have loaded, so the page never flashes an empty box.
 */
export function WorldMap({
  values,
  selected,
  onSelect,
  highlight,
  disabled,
  markers,
  projection = 'natural',
  focus,
  tooltip = true,
  formatTooltip,
  colors,
  ariaLabel = 'Map of the world',
  className,
  children,
}: WorldMapProps) {
  const [shapes, setShapes] = useState<Shapes | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    let live = true
    loadShapes().then(
      (loaded) => live && setShapes(loaded),
      () => live && setShapes({}),
    )
    return () => {
      live = false
    }
  }, [])

  const palette = { ...DEFAULT_COLORS, ...colors, scale: colors?.scale ?? DEFAULT_COLORS.scale }
  const transform = useMemo(() => makeTransform(projection), [projection])
  const highlighted = useMemo(() => new Set((highlight ?? []).map((code) => code.toUpperCase())), [highlight])
  const unavailable = useMemo(() => new Set((disabled ?? []).map((code) => code.toUpperCase())), [disabled])

  const range = useMemo(() => {
    const numbers = Object.values(values ?? {}).filter((value) => Number.isFinite(value))
    if (numbers.length === 0) return null
    return { min: Math.min(...numbers), max: Math.max(...numbers) }
  }, [values])

  const paths = useMemo(() => {
    if (!shapes) return []
    return COUNTRIES.filter((country) => shapes[country.code]).map((country) => ({
      country,
      d: pathFor(shapes[country.code]!, transform.point),
    }))
  }, [shapes, transform])

  /** The viewBox: the whole world, or the box around `focus`. */
  const viewBox = useMemo(() => {
    const whole = `0 0 ${VIEW_WIDTH} ${transform.height.toFixed(1)}`
    if (!focus || !shapes) return whole
    let box: { minLat: number; maxLat: number; minLon: number; maxLon: number } | null = null
    if (typeof focus === 'string') {
      const country = countryByCode(focus)
      if (country && shapes[country.code]) {
        box = boundsOfRings(shapes[country.code]!)
      } else {
        const region = focus.trim().toLowerCase()
        const rings = COUNTRIES.filter(
          (c) => c.region.toLowerCase() === region || c.subregion.toLowerCase() === region,
        ).flatMap((c) => shapes[c.code] ?? [])
        if (rings.length) box = boundsOfRings(rings)
      }
    } else {
      box = focus
    }
    if (!box || !Number.isFinite(box.minLat)) return whole
    // Project the corners and the edge midpoints: a curved projection bulges between them.
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 0; i <= 8; i++) {
      const lon = box.minLon + ((box.maxLon - box.minLon) * i) / 8
      for (let j = 0; j <= 8; j++) {
        const lat = box.minLat + ((box.maxLat - box.minLat) * j) / 8
        const [x, y] = transform.point(lon, lat)
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    const padX = Math.max((maxX - minX) * 0.08, 8)
    const padY = Math.max((maxY - minY) * 0.08, 8)
    return `${(minX - padX).toFixed(1)} ${(minY - padY).toFixed(1)} ${(maxX - minX + padX * 2).toFixed(1)} ${(maxY - minY + padY * 2).toFixed(1)}`
  }, [focus, shapes, transform])

  const fillFor = useCallback(
    (country: Country) => {
      const code = country.code
      if (unavailable.has(code)) return palette.land
      if (selected && code === selected.toUpperCase()) return palette.selected
      if (hovered === code) return palette.hover
      if (highlighted.has(code)) return palette.accent
      const value = values?.[code]
      if (range && typeof value === 'number' && Number.isFinite(value)) {
        const t = range.max === range.min ? 1 : (value - range.min) / (range.max - range.min)
        return mix(palette.scale[0], palette.scale[1], t)
      }
      return palette.land
    },
    [highlighted, hovered, palette, range, selected, unavailable, values],
  )

  const choose = useCallback(
    (country: Country) => {
      if (!onSelect || unavailable.has(country.code)) return
      onSelect(selected && selected.toUpperCase() === country.code ? null : country)
    },
    [onSelect, selected, unavailable],
  )

  const hoveredCountry = hovered ? countryByCode(hovered) : undefined
  const tooltipText =
    tooltip && hoveredCountry
      ? (formatTooltip?.(hoveredCountry, values?.[hoveredCountry.code]) ??
        (typeof values?.[hoveredCountry.code] === 'number'
          ? `${countryName(hoveredCountry)}: ${values[hoveredCountry.code]}`
          : countryName(hoveredCountry)))
      : null

  return (
    <div ref={frameRef} className={className ?? 'relative w-full'}>
      <svg
        viewBox={viewBox}
        role="img"
        aria-labelledby={titleId}
        className="h-auto w-full"
        style={{ backgroundColor: palette.water }}
        onMouseLeave={() => {
          setHovered(null)
          setPointer(null)
        }}
        onMouseMove={(event) => {
          if (!tooltip) return
          const box = frameRef.current?.getBoundingClientRect()
          if (box) setPointer({ x: event.clientX - box.left, y: event.clientY - box.top })
        }}
      >
        <title id={titleId}>{ariaLabel}</title>
        {paths.map(({ country, d }) => {
          const selectable = Boolean(onSelect) && !unavailable.has(country.code)
          return (
            <path
              key={country.code}
              d={d}
              fill={fillFor(country)}
              stroke={palette.border}
              strokeWidth={0.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              tabIndex={selectable ? 0 : undefined}
              role={selectable ? 'button' : undefined}
              aria-label={selectable ? countryName(country) : undefined}
              aria-pressed={selectable ? selected?.toUpperCase() === country.code : undefined}
              style={{ cursor: selectable ? 'pointer' : undefined, outline: 'none', transition: 'fill 120ms ease' }}
              onMouseEnter={() => setHovered(country.code)}
              onFocus={() => setHovered(country.code)}
              onBlur={() => setHovered(null)}
              onClick={selectable ? () => choose(country) : undefined}
              onKeyDown={
                selectable
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        choose(country)
                      }
                    }
                  : undefined
              }
            />
          )
        })}
        {(markers ?? []).map((marker, index) => {
          const [x, y] = transform.point(marker.lon, marker.lat)
          return (
            <circle
              key={index}
              cx={x}
              cy={y}
              r={marker.size ?? 6}
              fill={marker.color ?? palette.accent}
              stroke="#ffffff"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: marker.onClick ? 'pointer' : undefined }}
              onClick={marker.onClick}
            >
              {marker.label ? <title>{marker.label}</title> : null}
            </circle>
          )
        })}
      </svg>
      {tooltipText && pointer ? (
        <div
          className="pointer-events-none absolute z-10 rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow-lg"
          style={{ left: pointer.x + 12, top: pointer.y + 12 }}
        >
          {tooltipText}
        </div>
      ) : null}
      {!shapes ? (
        <div className="pointer-events-none absolute inset-0 animate-pulse rounded-lg bg-slate-100/60" aria-hidden />
      ) : null}
      {children}
    </div>
  )
}

export { COUNTRIES, countryByCode, countryName, findCountry, searchCountries, countriesIn, distanceKm } from './countries'
export type { Country } from './countries'
