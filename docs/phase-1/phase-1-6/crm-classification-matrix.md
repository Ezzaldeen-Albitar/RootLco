# Phase 1-6 — CRM Personal-Data Classification Matrix

<!-- GENERATED from live crm introspection; do not hand-edit count tables. -->

Machine source: [`docs/database/crm-personal-data-classification.json`](../../database/crm-personal-data-classification.json), enforced in CI by `npm run validate:crm-classification` (job **Database migrations and RLS tests**). Every `crm` column carries a classification in {`public`, `internal`, `restricted`, `secret`}; the guard fails on any unclassified column, any stale entry, any invalid value, and any column that is both `restricted` and `searchable`.

**Columns classified:** 296 · **Restricted:** 7 · **Searchable:** 11

## Restricted columns (7) — sensitive-view gated, never searchable

| Column                                    | Searchable |
| ----------------------------------------- | ---------- |
| `company_profiles.registration_ref`       | no         |
| `company_profiles.tax_ref`                | no         |
| `individual_profiles.national_id_ref`     | no         |
| `partner_identifiers.normalized_value`    | no         |
| `partner_identifiers.raw_value`           | no         |
| `partner_sensitive_attributes.value_date` | no         |
| `partner_sensitive_attributes.value_text` | no         |

## Searchable columns (11) — projected into normalized search metadata

| Column                                       | Classification |
| -------------------------------------------- | -------------- |
| `business_partners.display_name`             | internal       |
| `company_profiles.legal_name`                | internal       |
| `company_profiles.legal_name_normalized`     | internal       |
| `company_profiles.trade_name`                | internal       |
| `company_profiles.trade_name_normalized`     | internal       |
| `contact_points.normalized_value`            | internal       |
| `contact_points.raw_value`                   | internal       |
| `individual_profiles.family_name`            | internal       |
| `individual_profiles.family_name_normalized` | internal       |
| `individual_profiles.given_name`             | internal       |
| `individual_profiles.given_name_normalized`  | internal       |
