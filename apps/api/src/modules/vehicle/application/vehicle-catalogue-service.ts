/**
 * Vehicle reference-catalogue READ service (P1-17 remediation,
 * `P1-27-INT-007`).
 *
 * Five list use cases, one call deep each. There is no write here: the catalogue
 * write path is a separate concern with its own permission, and the gap this
 * remediation closes is a **read** gap — a creation form that could not offer a
 * make, and a search result that could not name one.
 *
 * The scope union (platform rows plus the caller's own) is enforced by RLS, so
 * no method re-derives it. See the repository for why a `tenant_id` predicate
 * here would be strictly wrong rather than merely redundant.
 *
 * No transaction is opened — these are reads on the pipeline's read handle — and
 * `veh.vehicle.read` was already enforced by the request pipeline before any
 * method here runs.
 */
import { ApplicationService } from '@/server/layering';
import type { DbHandle } from '@/server/db/transaction';
import type { OrderingContract, Page, PageRequest } from '@/server/db/pagination';
import { resolveLimit, decodeCursor } from '@/server/db/pagination';
import type {
  CatalogueEntry,
  ModelEntry,
  TrimEntry,
  VehicleCatalogueRepository,
} from '../data/vehicle-catalogue-repository';
import {
  BODY_TYPE_ORDERING,
  MAKE_ORDERING,
  MODEL_ORDERING,
  POWERTRAIN_TYPE_ORDERING,
  TRIM_ORDERING,
} from '../data/vehicle-catalogue-repository';

export type { CatalogueEntry, ModelEntry, TrimEntry } from '../data/vehicle-catalogue-repository';

export interface PageInput {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export class VehicleCatalogueService extends ApplicationService {
  protected readonly module = 'vehicle';

  constructor(private readonly catalogue: VehicleCatalogueRepository) {
    super();
  }

  /**
   * Turns request input into a `PageRequest`, checking the cursor against the
   * ordering it was issued for.
   *
   * A cursor from `veh.makes:name_asc` replayed against `veh.models:name_asc`
   * would compare a make's name to a model's and silently return the wrong
   * window; `decodeCursor` refuses it.
   */
  #page(input: PageInput, contract: OrderingContract): PageRequest {
    return {
      limit: resolveLimit(input.limit),
      cursor: input.cursor === undefined ? null : decodeCursor(input.cursor, contract),
    };
  }

  async listMakes(db: DbHandle, input: PageInput): Promise<Page<CatalogueEntry>> {
    return this.catalogue.listMakes(db, this.#page(input, MAKE_ORDERING));
  }

  async listBodyTypes(db: DbHandle, input: PageInput): Promise<Page<CatalogueEntry>> {
    return this.catalogue.listBodyTypes(db, this.#page(input, BODY_TYPE_ORDERING));
  }

  async listPowertrainTypes(db: DbHandle, input: PageInput): Promise<Page<CatalogueEntry>> {
    return this.catalogue.listPowertrainTypes(db, this.#page(input, POWERTRAIN_TYPE_ORDERING));
  }

  /**
   * The models of one make.
   *
   * An unknown make yields an empty page rather than a 404. The make id came
   * from a list this same caller can already read, so "not found" would add
   * nothing — and answering differently for an id that exists in another
   * tenant would turn this into an existence oracle for their catalogue.
   */
  async listModels(db: DbHandle, makeId: string, input: PageInput): Promise<Page<ModelEntry>> {
    return this.catalogue.listModels(db, makeId, this.#page(input, MODEL_ORDERING));
  }

  async listTrims(db: DbHandle, modelId: string, input: PageInput): Promise<Page<TrimEntry>> {
    return this.catalogue.listTrims(db, modelId, this.#page(input, TRIM_ORDERING));
  }
}
