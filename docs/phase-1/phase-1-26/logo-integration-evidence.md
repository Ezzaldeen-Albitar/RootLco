# Phase 1-26 — logo integration evidence

**Classification:** Confidential — Commercial Product and Pilot Planning

The Owner supplied two PNG files and authorised their use. This records what
they actually contain, where they now live, how they are wired, and the one
place where what was supplied differs from how it was described.

---

## 1. What the Owner supplied

|                          | `Generated_logo.png`                                               | `Generated_NameLogo.png`                                           |
| ------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Bytes                    | 82,534                                                             | 47,289                                                             |
| Dimensions               | 302 × 378                                                          | 465 × 262                                                          |
| Aspect                   | 0.799 — portrait                                                   | 1.775 — landscape                                                  |
| Colour type              | 6 — truecolour + alpha (RGBA)                                      | 6 — truecolour + alpha (RGBA)                                      |
| Bit depth                | 8                                                                  | 8                                                                  |
| Alpha channel            | yes                                                                | yes                                                                |
| Interlaced               | no                                                                 | no                                                                 |
| `sRGB` / `gAMA`          | present / present                                                  | present / present                                                  |
| `iCCP` colour profile    | absent                                                             | absent                                                             |
| Text metadata            | none                                                               | none                                                               |
| Valid signature · `IEND` | yes · yes                                                          | yes · yes                                                          |
| SHA-256                  | `d2243fe149291fc6988120b38f703100fd674fd47d2a326d5452728f61b1f03e` | `568852ffc709ea044a922059049725a15343a730054b2962e24349e54f7c3443` |

Both are structurally valid, uncorrupted, carry real transparency, are not
byte-identical to each other, and carry no metadata concern. Neither was
re-encoded: the hashes above are the hashes of the files as supplied and as
committed.

## 2. What they depict — and the discrepancy

**`Generated_logo.png`** is an abstract interlaced monogram in near-black on
transparency. It carries **no name**. That makes it usable as the product symbol,
because a mark that spells nothing cannot spell the wrong thing.

**`Generated_NameLogo.png`** is a wordmark. It reads **`rootlco`**.

The instruction describing these files called the second one the _"full CRM
wordmark/name logo"_. It is not: it is the **company** wordmark. RootLco is the
company that builds the product; `CRM` is the product's Owner-approved working
name (OIR-01).

That distinction is not a nicety here. It is enforced:

- **ADR-011** keeps the product name pending and states RootLco is the company.
- `scripts/check-brand-isolation.mjs:41-45` fails the build on the literal
  `RootLco` anywhere outside `src/config`, with the reason
  _"renders `RootLco`, which is the COMPANY not the product name"_.
- `scripts/ci/check-product-name-authority.mjs` requires both tiers to name the
  product identically, and both name it `CRM`.

Putting the `rootlco` wordmark in the product's name slot would have broken that
rule **in the one way the gate cannot detect**: the gate matches a string, and an
image contains none. It would have shipped a silent violation of a rule the
repository cares enough about to gate.

### How it was resolved

Both files are integrated. Neither is unused, and nothing was invented.

| Asset                  | Role                    | Where                                                                                              |
| ---------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| `crm-symbol.png`       | **product symbol**      | sidebar (expanded + collapsed + drawer), auth shell, mobile header, print header, browser tab icon |
| `rootlco-wordmark.png` | **company attribution** | the auth shell's navy panel, rendered under "by"                                                   |

The product identity is therefore **symbol + `CRM`**: the Owner's artwork carries
the mark, and the approved product name carries the name. The company wordmark
appears where a company mark belongs.

> **If the Owner intends `rootlco` to become the product wordmark**, that is a
> product-naming decision (it supersedes OIR-01), not a wiring change. The
> implementation is two fields in `apps/web/src/config/brand.ts` —
> `logoAsset: '/brand/rootlco-wordmark.png'` and `logoAssetSize: { width: 465, height: 262 }` —
> plus `systemName`, and the isolation gate and the product-name authority gate
> would both need their ADR-011 basis revisited first. No component changes.

## 3. Canonical paths

```
apps/web/public/brand/crm-symbol.png        <- Generated_logo.png
apps/web/public/brand/rootlco-wordmark.png  <- Generated_NameLogo.png
```

Moved with `git mv`, so the bytes are unchanged and the hashes in §1 still match.
**No copy remains at `apps/web/public/`**, and no file named `Generated_*`
exists anywhere in the tree.

## 4. The single authority

Every path above appears in exactly one file: `apps/web/src/config/brand.ts`.
No component, route, stylesheet or message catalogue names an asset.

```
apps/web/src/config/brand.ts              declares the paths and intrinsic sizes
apps/web/src/components/brand/BrandMark.tsx   the only component that renders them
apps/web/src/components/brand/theme.ts        exposes the icon href to the root layout
```

The root layout needs a tab icon, but a `/brand/*.png` literal in `src/app/` is
exactly what the `logo-asset` rule forbids — so it reads `brandIconHref` from the
brand layer instead. Routing never learns the identity.

`resolveCompanyMark` is a **separate resolver** rather than a widened
`BrandMarkModel`. That union is asserted shape-for-shape by
`brand-replacement.test.ts`, and more importantly the two marks have different
failure modes: an absent product mark must still name the product, an absent
company attribution is simply absent.

## 5. Rendering

| Surface                  | Renders                                    | Notes                                                                                                      |
| ------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Sidebar, expanded        | symbol + `CRM`                             | name is `aria-hidden`; the image alt carries it                                                            |
| Sidebar, collapsed       | symbol                                     | alt still names the product, so the rail is not a nameless icon                                            |
| Mobile drawer            | symbol + `CRM`                             | same component                                                                                             |
| Mobile header (`< lg`)   | symbol                                     | added because below `lg` the sidebar is a drawer and the product was otherwise unnamed on screen           |
| Auth shell, navy panel   | symbol + `CRM`, and the company mark below | company mark is `brightness-0 invert` — the artwork is dark on transparency and would be invisible on navy |
| Auth shell, small header | symbol + `CRM`                             |                                                                                                            |
| Print header             | symbol + `CRM`                             | `PrintDocument` takes the brand as a slot; no print-specific code                                          |
| Browser tab              | symbol                                     | via `brandIconHref`                                                                                        |

**Fallback.** With `logoAsset: null` the resolver returns the wordmark model and
the product renders as the text `CRM`. A missing logo degrades to a readable name,
never to a broken image — asserted by
`brand-replacement.test.ts` _"falls back to the wordmark when asset mode is set
but no asset is supplied"_.

**Layout shift.** Both images declare `width` and `height` computed from the
configured intrinsic size, so the box is reserved before the bytes arrive.

**Direction.** Neither mark is mirrored under RTL. Logos are artwork, not text
flow; `_rtl.scss` mirroring applies to logical properties, and no transform is
applied to either element.

## 6. Required final values

|                                     |                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------- |
| Untracked approved logo files       | **0**                                                                  |
| Unused approved logo files          | **0**                                                                  |
| Duplicate logo authorities          | **0** — one `export const brand`, asserted by `check-web-topology.mjs` |
| Files named `Generated_*` remaining | **0**                                                                  |
| Brand-isolation violations          | **0** of 131 files inspected                                           |
| Design-token violations             | **0** of 129 files inspected                                           |
| Broken logo requests                | measured in `authenticated-browser-evidence.md`                        |

## 7. Regression coverage

`apps/web/tests/brand-replacement.test.ts` — six new cases:

- the live configuration resolves to the **symbol**, with `CRM` as its accessible name;
- the symbol publishes its intrinsic size, so the header cannot reflow;
- a text mark publishes **no** size, because there is no box to reserve;
- the company mark resolves with the company name as its accessible name;
- an unconfigured company mark returns `null` rather than degrading to text;
- **the company wordmark can never become the product mark** — different `src`,
  different accessible name, and the product's name is `brand.systemName`.

The last one is the load-bearing case. It is the only thing standing between the
company wordmark and the product's name slot, because the gate that would
otherwise catch it matches strings and an image has none.
