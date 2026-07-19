# Phase 1-6 — CRM Object Inventory

<!-- GENERATED from live crm introspection; do not hand-edit count tables. -->

Generated from the live `crm` schema. Totals: **21 tables, 298 columns, 13 functions, 45 triggers, 58 policies, 68 indexes, 51 foreign keys, 73 check constraints.**

## Tables (21)

| Table                          | Columns | RLS forced |
| ------------------------------ | ------- | ---------- |
| `addresses`                    | 20      | ✅         |
| `business_partners`            | 15      | ✅         |
| `communication_log`            | 17      | ✅         |
| `communication_preferences`    | 13      | ✅         |
| `company_profiles`             | 15      | ✅         |
| `consent_history`              | 15      | ✅         |
| `contact_points`               | 17      | ✅         |
| `customer_alerts`              | 16      | ✅         |
| `customer_block_history`       | 11      | ✅         |
| `customer_credit_profiles`     | 15      | ✅         |
| `customer_restrictions`        | 14      | ✅         |
| `customer_segments`            | 13      | ✅         |
| `duplicate_candidates`         | 15      | ✅         |
| `individual_profiles`          | 15      | ✅         |
| `partner_identifiers`          | 16      | ✅         |
| `partner_merges`               | 10      | ✅         |
| `partner_roles`                | 12      | ✅         |
| `partner_segment_assignments`  | 13      | ✅         |
| `partner_sensitive_attributes` | 14      | ✅         |
| `partner_status_history`       | 11      | ✅         |
| `timeline_events`              | 11      | ✅         |

## Functions (13)

All `SECURITY INVOKER`, `search_path=''`. No `SECURITY DEFINER` exists in `crm`.

| Function                        | Security | Volatility |
| ------------------------------- | -------- | ---------- |
| `current_consent`               | INVOKER  | STABLE     |
| `emit_timeline_event`           | INVOKER  | VOLATILE   |
| `guard_business_partner_merge`  | INVOKER  | VOLATILE   |
| `guard_consent_insert`          | INVOKER  | VOLATILE   |
| `guard_partner_block_coherence` | INVOKER  | VOLATILE   |
| `jsonb_no_raw_value_keys`       | INVOKER  | IMMUTABLE  |
| `normalize_email`               | INVOKER  | IMMUTABLE  |
| `normalize_name`                | INVOKER  | IMMUTABLE  |
| `normalize_phone`               | INVOKER  | IMMUTABLE  |
| `partner_roles_active_at`       | INVOKER  | STABLE     |
| `resolve_partner_survivor`      | INVOKER  | STABLE     |
| `stamp_partner_merge`           | INVOKER  | VOLATILE   |
| `stamp_timeline_event`          | INVOKER  | VOLATILE   |

## Triggers (45)

| Table                          | Trigger                                          |
| ------------------------------ | ------------------------------------------------ |
| `addresses`                    | `tg_addresses_immutable`                         |
| `addresses`                    | `tg_addresses_touch_metadata`                    |
| `business_partners`            | `tg_business_partners_block_coherence`           |
| `business_partners`            | `tg_business_partners_immutable`                 |
| `business_partners`            | `tg_business_partners_merge_guard`               |
| `business_partners`            | `tg_business_partners_touch_metadata`            |
| `communication_log`            | `tg_communication_log_immutable`                 |
| `communication_log`            | `tg_communication_log_timeline`                  |
| `communication_log`            | `tg_communication_log_touch_metadata`            |
| `communication_preferences`    | `tg_communication_preferences_immutable`         |
| `communication_preferences`    | `tg_communication_preferences_touch_metadata`    |
| `company_profiles`             | `tg_company_profiles_immutable`                  |
| `company_profiles`             | `tg_company_profiles_touch_metadata`             |
| `consent_history`              | `tg_consent_history_stamp`                       |
| `consent_history`              | `tg_consent_history_timeline`                    |
| `contact_points`               | `tg_contact_points_immutable`                    |
| `contact_points`               | `tg_contact_points_touch_metadata`               |
| `customer_alerts`              | `tg_customer_alerts_immutable`                   |
| `customer_alerts`              | `tg_customer_alerts_timeline`                    |
| `customer_alerts`              | `tg_customer_alerts_touch_metadata`              |
| `customer_block_history`       | `tg_customer_block_history_stamp`                |
| `customer_block_history`       | `tg_customer_block_history_timeline`             |
| `customer_credit_profiles`     | `tg_customer_credit_profiles_immutable`          |
| `customer_credit_profiles`     | `tg_customer_credit_profiles_touch_metadata`     |
| `customer_restrictions`        | `tg_customer_restrictions_immutable`             |
| `customer_restrictions`        | `tg_customer_restrictions_touch_metadata`        |
| `customer_segments`            | `tg_customer_segments_immutable`                 |
| `customer_segments`            | `tg_customer_segments_touch_metadata`            |
| `duplicate_candidates`         | `tg_duplicate_candidates_immutable`              |
| `duplicate_candidates`         | `tg_duplicate_candidates_touch_metadata`         |
| `individual_profiles`          | `tg_individual_profiles_immutable`               |
| `individual_profiles`          | `tg_individual_profiles_touch_metadata`          |
| `partner_identifiers`          | `tg_partner_identifiers_immutable`               |
| `partner_identifiers`          | `tg_partner_identifiers_touch_metadata`          |
| `partner_merges`               | `tg_partner_merges_stamp`                        |
| `partner_merges`               | `tg_partner_merges_timeline`                     |
| `partner_roles`                | `tg_partner_roles_immutable`                     |
| `partner_roles`                | `tg_partner_roles_touch_metadata`                |
| `partner_segment_assignments`  | `tg_partner_segment_assignments_immutable`       |
| `partner_segment_assignments`  | `tg_partner_segment_assignments_touch_metadata`  |
| `partner_sensitive_attributes` | `tg_partner_sensitive_attributes_immutable`      |
| `partner_sensitive_attributes` | `tg_partner_sensitive_attributes_touch_metadata` |
| `partner_status_history`       | `tg_partner_status_history_stamp`                |
| `partner_status_history`       | `tg_partner_status_history_timeline`             |
| `timeline_events`              | `tg_timeline_events_stamp`                       |

## Indexes (68)

| Table                          | Index                                               | Unique | Partial |
| ------------------------------ | --------------------------------------------------- | ------ | ------- |
| `addresses`                    | `ix_addresses_partner`                              |        |         |
| `addresses`                    | `pk_addresses`                                      | ✅     |         |
| `addresses`                    | `uq_addresses_primary_active`                       | ✅     | ✅      |
| `business_partners`            | `ix_business_partners_merged_into`                  |        | ✅      |
| `business_partners`            | `ix_business_partners_tenant_lifecycle`             |        |         |
| `business_partners`            | `pk_business_partners`                              | ✅     |         |
| `business_partners`            | `uq_business_partners_tenant_display_number_active` | ✅     | ✅      |
| `business_partners`            | `uq_business_partners_tenant_id`                    | ✅     |         |
| `business_partners`            | `uq_business_partners_tenant_id_party_type`         | ✅     |         |
| `communication_log`            | `ix_communication_log_outbound`                     |        | ✅      |
| `communication_log`            | `ix_communication_log_partner_time`                 |        |         |
| `communication_log`            | `pk_communication_log`                              | ✅     |         |
| `communication_preferences`    | `pk_communication_preferences`                      | ✅     |         |
| `communication_preferences`    | `uq_communication_preferences_dims`                 | ✅     |         |
| `company_profiles`             | `ix_company_profiles_registration`                  |        | ✅      |
| `company_profiles`             | `ix_company_profiles_tax`                           |        | ✅      |
| `company_profiles`             | `pk_company_profiles`                               | ✅     |         |
| `company_profiles`             | `uq_company_profiles_partner`                       | ✅     |         |
| `consent_history`              | `ix_consent_history_resolve`                        |        |         |
| `consent_history`              | `pk_consent_history`                                | ✅     |         |
| `contact_points`               | `ix_contact_points_normalized`                      |        | ✅      |
| `contact_points`               | `pk_contact_points`                                 | ✅     |         |
| `contact_points`               | `uq_contact_points_primary_active`                  | ✅     | ✅      |
| `contact_points`               | `uq_contact_points_tenant_partner_id`               | ✅     |         |
| `customer_alerts`              | `ix_customer_alerts_active`                         |        | ✅      |
| `customer_alerts`              | `pk_customer_alerts`                                | ✅     |         |
| `customer_block_history`       | `ix_customer_block_history_partner_time`            |        |         |
| `customer_block_history`       | `pk_customer_block_history`                         | ✅     |         |
| `customer_credit_profiles`     | `pk_customer_credit_profiles`                       | ✅     |         |
| `customer_credit_profiles`     | `uq_customer_credit_profiles_partner`               | ✅     |         |
| `customer_restrictions`        | `ix_customer_restrictions_active`                   |        |         |
| `customer_restrictions`        | `ix_customer_restrictions_open`                     |        | ✅      |
| `customer_restrictions`        | `pk_customer_restrictions`                          | ✅     |         |
| `customer_restrictions`        | `uq_customer_restrictions_tenant_partner_id`        | ✅     |         |
| `customer_segments`            | `ix_customer_segments_tenant`                       |        |         |
| `customer_segments`            | `pk_customer_segments`                              | ✅     |         |
| `customer_segments`            | `uq_customer_segments_code_active`                  | ✅     | ✅      |
| `customer_segments`            | `uq_customer_segments_tenant_id`                    | ✅     |         |
| `duplicate_candidates`         | `ix_duplicate_candidates_a`                         |        |         |
| `duplicate_candidates`         | `ix_duplicate_candidates_b`                         |        |         |
| `duplicate_candidates`         | `ix_duplicate_candidates_status`                    |        |         |
| `duplicate_candidates`         | `pk_duplicate_candidates`                           | ✅     |         |
| `duplicate_candidates`         | `uq_duplicate_candidates_open`                      | ✅     | ✅      |
| `individual_profiles`          | `ix_individual_profiles_national_id`                |        | ✅      |
| `individual_profiles`          | `pk_individual_profiles`                            | ✅     |         |
| `individual_profiles`          | `uq_individual_profiles_partner`                    | ✅     |         |
| `partner_identifiers`          | `pk_partner_identifiers`                            | ✅     |         |
| `partner_identifiers`          | `uq_partner_identifiers_primary_active`             | ✅     | ✅      |
| `partner_identifiers`          | `uq_partner_identifiers_tenant_id`                  | ✅     |         |
| `partner_identifiers`          | `uq_partner_identifiers_tenant_partner_id`          | ✅     |         |
| `partner_identifiers`          | `uq_partner_identifiers_value_active`               | ✅     | ✅      |
| `partner_merges`               | `ix_partner_merges_survivor`                        |        |         |
| `partner_merges`               | `pk_partner_merges`                                 | ✅     |         |
| `partner_merges`               | `uq_partner_merges_source`                          | ✅     |         |
| `partner_roles`                | `ex_partner_roles_no_overlap`                       |        |         |
| `partner_roles`                | `ix_partner_roles_lookup`                           |        |         |
| `partner_roles`                | `pk_partner_roles`                                  | ✅     |         |
| `partner_roles`                | `uq_partner_roles_tenant_id`                        | ✅     |         |
| `partner_segment_assignments`  | `ex_partner_segment_assignments_no_overlap`         |        |         |
| `partner_segment_assignments`  | `ix_partner_segment_assignments_lookup`             |        |         |
| `partner_segment_assignments`  | `ix_partner_segment_assignments_segment`            |        |         |
| `partner_segment_assignments`  | `pk_partner_segment_assignments`                    | ✅     |         |
| `partner_sensitive_attributes` | `pk_partner_sensitive_attributes`                   | ✅     |         |
| `partner_sensitive_attributes` | `uq_partner_sensitive_attributes_active`            | ✅     | ✅      |
| `partner_status_history`       | `ix_partner_status_history_partner_time`            |        |         |
| `partner_status_history`       | `pk_partner_status_history`                         | ✅     |         |
| `timeline_events`              | `ix_timeline_events_partner_time`                   |        |         |
| `timeline_events`              | `pk_timeline_events`                                | ✅     |         |
