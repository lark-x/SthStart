# Character card source provider spike

Date: 2026-09-08

Scope: validate one real character-card provider before implementing the in-app search and import flow. This report records the public protocol shape only; no third-party card payload is committed to the repository.

## Chosen provider

Character Tavern is the first verified provider for this release. Its public catalog is available at `https://character-tavern.com/search/cards`.

Observed read-only calls:

| Operation | Request | Result |
| --- | --- | --- |
| English search | `GET https://character-tavern.com/api/search/cards?query=Genshin&limit=2` | HTTP 200; `hits`, `totalHits`, `hitsPerPage`, `page`, `totalPages`; stable `id` and `path` |
| Chinese search | `GET https://character-tavern.com/api/search/cards?query=%E5%8E%9F%E7%A5%9E&limit=2` | HTTP 200; returned two real catalog hits and the same pagination shape |
| Detail | `GET https://character-tavern.com/api/character/dbralba/genshin_impact__massive_lore` | HTTP 200; `card` object with name, path, author, definition fields and `versionId` |
| Card download | `GET https://ct-cards.storage.character-tavern.com/dbralba/genshin_impact__massive_lore.png?action=download` | HTTP 200; `image/png`; PNG signature and `800 x 800` image; observed SHA-256 `c4d3bf2f9f049ff656a4dc9c97f0cfc34f21eeb41c99d86392130a7ceb284778` |

The detail page also exposed the stable browser URL `https://character-tavern.com/character/{author}/{path}` and the download pattern `https://ct-cards.storage.character-tavern.com/{path}.png?action=download`. The implementation treats these as provider-specific adapter details, not as a general card URL rule.

Authentication was not required for the calls above. Rate-limit and HTTP failure behavior is covered by the adapter tests and is surfaced as a provider error rather than an empty result.

## Response shape used by the adapter

The catalog response is normalized from:

```json
{
  "hits": [{
    "id": "CT_…",
    "name": "Genshin Impact RPG",
    "path": "legodudelol9a/genshin_impact_rpg",
    "tagline": "Genshin Impact RPG",
    "author": "legodudelol9a",
    "lastUpdateAt": 1786838289
  }],
  "hitsPerPage": 2,
  "page": 1,
  "totalPages": 300,
  "totalHits": 600
}
```

The detail response is `{ "card": { ... }, "ownerCTId": "..." }`. The detail `author` can be numeric while search results expose a display handle; the adapter preserves the value as supplied and does not invent an author name.

## Chub check

The documented Chub gateway (`https://gateway.chub.ai/docs`) and the public search endpoint were checked on the same date. The request returned HTTP 403 with the provider message `This service is not available in your country`. It is therefore recorded as unavailable in this environment and is not used as the release provider. No VPN, proxy, account token, or browser-only workaround is assumed.

## Failure and safety boundaries

- Empty `hits` is a successful no-result response; it is not treated as a provider outage.
- 401/403, 429, timeout, malformed JSON, and malformed card downloads are distinct adapter errors.
- The adapter only follows its own fixed catalog/detail/download origins. User-provided URLs use the separate controlled URL importer and are not executed as card resources.
- The downloaded PNG is archived as the import snapshot and parsed locally. The preview and commit therefore use the same bytes even if the remote card changes after preview.
- The public site contains scene/RPG cards. The import preview marks those as scene-card candidates and does not split their cast into official characters.

## Verification status

The real provider loop—search → detail → download—passed outside the offline test suite on 2026-09-08. A human in-app confirm/cancel run, multimodal extraction, and ComfyUI GPU runs remain separately reported acceptance items; they are not implied by this network spike.
