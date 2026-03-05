// apps/backend/src/shared/mappers/caseList.mapper.ts
// Purpose: Convert Prisma Case list query rows into the transport-safe CaseListItem DTO used by the API.

/*
Assumptions
- DTOs are exported from @posta/core.
- Prisma query shape matches the select used in cases.controller.ts.
- Enums come from @posta/core generated source.
- No Prisma types leak past this layer.
*/

import type { CaseListItem, RoutingOutcome, CaseLifecycle } from "@posta/core";

/* -------------------------------------------------------------------------- */
/* Helper Types                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Shape returned by the Prisma query in listCases controller.
 * This avoids importing Prisma types here and keeps the mapper
 * independent from persistence layer details.
 */
export interface CaseListQueryRow {
  id: string;

  // Must align with CaseListItem lifecycle enum
  lifecycle: CaseLifecycle;

  type: string;
  scope: string;

  sdgGoal: string | null;
  summary: string | null;

  createdAt: Date;
  updatedAt: Date;

  currentTaskDefinitionId: string | null;

  currentTaskDefinition: {
    id: string;
    label: string;
  } | null;

  routingDecisions: {
    routingOutcome: RoutingOutcome;
  }[];

  messages: {
    body: string | null;
    type: string;
    createdAt: Date;
  }[];
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function toIso(date: Date): string {
  return date.toISOString();
}

/* -------------------------------------------------------------------------- */
/* Mapper                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * mapCaseListItem
 *
 * Converts a raw Prisma row into a CaseListItem DTO.
 * Strictly aligned with @posta/core transport contract.
 */
export function mapCaseListItem(row: CaseListQueryRow): CaseListItem {
  const routingOutcome: RoutingOutcome =
    row.routingDecisions[0]?.routingOutcome ?? "UNASSIGNED";

  const lastMessage =
    row.messages[0] !== undefined
      ? {
          body: row.messages[0].body,
          type: row.messages[0].type,
          createdAt: row.messages[0].createdAt.toISOString(),
        }
      : null;

  return {
    id: row.id,

    lifecycle: row.lifecycle,

    routingOutcome,

    // Contract expects a single string field
    currentTask: row.currentTaskDefinition?.label ?? "UNASSIGNED",

    type: row.type,
    scope: row.scope,

    sdgGoal: row.sdgGoal,
    summary: row.summary,

    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),

    lastMessage,
  };
}

/**
 * Batch mapper
 */
export function mapCaseListItems(rows: CaseListQueryRow[]): CaseListItem[] {
  return rows.map(mapCaseListItem);
}

/* -------------------------------------------------------------------------- */
/* Design reasoning                                                           */
/* --------------------------------------------------------------------------

This mapper enforces a strict boundary between persistence (Prisma)
and the public HTTP contract (@posta/core).

The DTO shape must mirror CaseListItem exactly.
No extra fields. No renamed fields. No Prisma enums leaking.

Enum alignment (CaseLifecycle, RoutingOutcome) ensures compile-time
guarantees that the API cannot drift from the canonical contract.

-------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Structure                                                                  */
/* --------------------------------------------------------------------------

CaseListQueryRow
  Local representation of Prisma query output

mapCaseListItem()
  Converts single row → CaseListItem DTO

mapCaseListItems()
  Batch helper for controller usage

-------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Implementation guidance                                                    */
/* --------------------------------------------------------------------------

Controller usage:

import { mapCaseListItems } from "../../shared/mappers/caseList.mapper";

const rows = await prisma.case.findMany({...});
const cases = mapCaseListItems(rows);

-------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Scalability insight                                                        */
/* --------------------------------------------------------------------------

This mapper is projection-safe. If later you introduce:
- Read model tables
- Redis cache layer
- Materialized views

You can swap the data source without changing the API contract.

-------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Example usage                                                              */
/* --------------------------------------------------------------------------

const dto = mapCaseListItem(row);
console.log(dto.lifecycle);

-------------------------------------------------------------------------- */
