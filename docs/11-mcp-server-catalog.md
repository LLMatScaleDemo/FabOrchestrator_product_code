# 11 — MCP server & tool catalog (FabInsight data plane)

> Code version: commit `abe8706` on `main` (the pin for this doc set).
> Validation: 🟢 **Runtime-validated** — tool lists were obtained by calling each
> server's MCP `tools/list` endpoint on **2026-07-24**, not by reading code.
> Server inventory is 🔵 Static (read from `admin_athena/prisma/seed.ts:145`).

## Why this page exists

The FabOrchestrator repo contains **no list of MCP tools**. Tool names, descriptions and
argument schemas are defined inside the Python MCP servers (AWS Lambda behind API
Gateway), which are *not* in this repo, and are only copied into the app's database
(`mcp_connections.available_tools`) after an operator runs discovery. On a fresh
environment that column is empty.

This page is therefore the first record of these tools that exists on our side. It was
produced by speaking the MCP protocol directly to each registered server.

### Why it matters for FabInsight

`/api/chat` — the route behind the FabInsight™ card — has **no CMF/MES code path of its
own**. Its only door to fab data is the MCP tools loaded at
`claudeai_athena/app/api/chat/route.ts:454`. Everything FabInsight can answer is
therefore bounded by the tools catalogued below.

The FabInsight™ control-flow trace (cockpit card → `/chat` → MCP) is **not yet written** —
see the "Remaining work" note in [`07-signoff-tracker.md`](./07-signoff-tracker.md) §7.7.

## How to reproduce

Read-only, unauthenticated, no credentials required:

```bash
U="https://sd6ch0xtng.execute-api.us-west-2.amazonaws.com/mcp"
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"clientInfo":{"name":"llmatscale-ai","version":"1.0.0"}}}'

# 1. handshake — capture the Mcp-Session-Id response header
curl -sS -X POST "$U" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' -d "$INIT" -D -

# 2. list tools, echoing that session id back
curl -sS -X POST "$U" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' -H "Mcp-Session-Id: <id>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

The handshake is mandatory — `tools/list` without a session id returns HTTP 500.
Protocol version and client identity match `claudeai_athena/lib/mcp-client.ts:147-160`.

## Server inventory

All 10 are seeded by `admin_athena/prisma/seed.ts:145-171` with `authType: 'none'`.

| Server (display name) | Backend | Tool prefix | Tools | Status 2026-07-24 |
|---|---|---|---:|---|
| CMF - Critical Manufacturing | CMF SQL Server (Critical Manufacturing) | `cmf_` | 17 | 🟢 up |
| CM MES - Assembly | KSP `EntegrisKSPUpgrade` | `ksp_` | 17 | 🟢 up |
| CM MES - Lab Data | HRL Labs | `hrl_` | 17 | 🟢 up |
| Opcenter - Siemens | Opcenter SQL Server | `opc_` | 17 | 🟢 up |
| Opcenter - CoreSi | AIMES SQL Server | `aimes_` | 17 | 🟢 up |
| Lumentum Server | Opcenter Semi SQL Server | `semi_opc_` | 17 | 🟢 up |
| PSI Quantum | PSI Quantum stored-procedure catalog | `psiq_` | 15 | 🟢 up |
| Bottleneck Analysis | `Bottleneck_MCP` views + stored procedures | — (unprefixed) | 9 | 🟢 up |
| Genealogy | — | — | — | 🔴 **HTTP 500** |
| Scrap Pareto | — | — | — | 🔴 **HTTP 500** |

**Genealogy and Scrap Pareto were unreachable** — every request (including a bare
`GET /`) returns `500 Internal Server Error` from API Gateway, i.e. the route exists but
the backing Lambda fails. Both correspond to named Entegris use cases (see §Use-case map).

## The common server template

Six of the eight live servers are the **same server implementation** pointed at different
MES databases. Each exposes 17 tools in three groups:

1. **One query executor** — `run_<prefix>_query`: *"Execute a read-only T-SQL SELECT query."*
2. **Six schema-introspection tools** — `list_schemas`, `list_tables`, `describe_table`,
   `search_columns`, `get_relationships`, `get_sample_data`.
3. **~10 topic guides** — `<prefix>_topic_*`, each returning a schema guide for one analysis
   area (OEE, cycle time, material tracking, quality, throughput, facility, …).

> **No tool implements a use case.** There is no `get_oee` or `build_pareto`. The model calls
> a topic guide, receives the relevant table/column names, writes T-SQL itself, and runs it
> through the executor. This is what the system prompt's *"Discover before querying: list
> tables and describe schemas first"* (`lib/system-prompts.ts:64`) is steering.

Consequence for documentation: **the MES table names are not knowable from this repo, nor
from the tool list.** They are returned at runtime by the `*_topic_*` tools. Cataloguing
them requires calling those tools (not yet done — see open questions).

## Tools by server

### CMF - Critical Manufacturing

`https://sd6ch0xtng.execute-api.us-west-2.amazonaws.com/mcp` — backend: CMF SQL Server (Critical Manufacturing) — **17 tools**

| Tool | Description | Arguments |
|---|---|---|
| `run_cmf_query` | Execute a read-only T-SQL SELECT query against CMF Critical Manufacturing databases. | `sql`, `database`, `limit` |
| `cmf_list_schemas` | List all schemas and their table counts in the specified CMF database. | `database` |
| `cmf_list_tables` | List tables in a specific schema with row counts and column counts. | `schema`, `database`, `filter` |
| `cmf_describe_table` | Get detailed column information for a specific table. | `table`, `schema`, `database` |
| `cmf_search_columns` | Search for columns matching a name pattern across all tables in a database. | `column_pattern`, `database`, `schema` |
| `cmf_get_relationships` | Get foreign key relationships for a table (both outgoing and incoming). | `table`, `schema`, `database` |
| `cmf_get_sample_data` | Get sample rows from a table to understand actual data values. | `table`, `schema`, `database`, `rows` |
| `cmf_topic_wip` | Get schema guide for Work In Process (WIP) analysis on CMF. | — |
| `cmf_topic_material_tracking` | Get schema guide for Material Trace & Movement analysis on CMF. | — |
| `cmf_topic_cycle_time` | Get schema guide for Cycle Time analysis on CMF. | — |
| `cmf_topic_resource_utilization` | Get schema guide for Equipment OEE & Utilization analysis on CMF. | — |
| `cmf_topic_downtime` | Get schema guide for Equipment Downtime & MTBF/MTTR analysis on CMF. | — |
| `cmf_topic_production_orders` | Get schema guide for Production Order Status analysis on CMF. | — |
| `cmf_topic_quality` | Get schema guide for Data Collection & Quality analysis on CMF. | — |
| `cmf_topic_throughput` | Get schema guide for Throughput & Yield analysis on CMF. | — |
| `cmf_topic_products` | Get schema guide for Product Catalog & Groups analysis on CMF. | — |
| `cmf_topic_facility` | Get schema guide for Facility & Area Hierarchy analysis on CMF. | — |

### CM MES - Assembly

`https://9vh4xw2kb1.execute-api.us-west-2.amazonaws.com/mcp` — backend: KSP `EntegrisKSPUpgrade` — **17 tools**

| Tool | Description | Arguments |
|---|---|---|
| `run_ksp_query` | Execute a read-only T-SQL SELECT query against KSP EntegrisKSPUpgrade databases. | `sql`, `database`, `limit` |
| `ksp_list_schemas` | List all schemas and their table counts in the specified KSP database. | `database` |
| `ksp_list_tables` | List tables in a specific schema with row counts and column counts. | `schema`, `database`, `filter` |
| `ksp_describe_table` | Get detailed column information for a specific table. | `table`, `schema`, `database` |
| `ksp_search_columns` | Search for columns matching a name pattern across all tables in a database. | `column_pattern`, `database`, `schema` |
| `ksp_get_relationships` | Get foreign key relationships for a table (both outgoing and incoming). | `table`, `schema`, `database` |
| `ksp_get_sample_data` | Get sample rows from a table to understand actual data values. | `table`, `schema`, `database`, `rows` |
| `ksp_topic_wip` | Get schema guide for Work In Process (WIP) analysis on KSP. | — |
| `ksp_topic_material_tracking` | Get schema guide for Material Trace & Movement analysis on KSP. | — |
| `ksp_topic_cycle_time` | Get schema guide for Cycle Time analysis on KSP. | — |
| `ksp_topic_resource_utilization` | Get schema guide for Equipment OEE & Utilization analysis on KSP. | — |
| `ksp_topic_downtime` | Get schema guide for Equipment Downtime & MTBF/MTTR analysis on KSP. | — |
| `ksp_topic_production_orders` | Get schema guide for Production Order Status analysis on KSP. | — |
| `ksp_topic_quality` | Get schema guide for Data Collection & Quality analysis on KSP. | — |
| `ksp_topic_throughput` | Get schema guide for Throughput & Yield analysis on KSP. | — |
| `ksp_topic_products` | Get schema guide for Product Catalog & Groups analysis on KSP. | — |
| `ksp_topic_facility` | Get schema guide for Facility & Area Hierarchy analysis on KSP. | — |

### CM MES - Lab Data

`https://f09ls0pyr9.execute-api.us-west-2.amazonaws.com/mcp` — backend: HRL Labs — **17 tools**

| Tool | Description | Arguments |
|---|---|---|
| `run_hrl_query` | Execute a read-only T-SQL SELECT query against HRL Labs databases. | `sql`, `database`, `limit` |
| `hrl_list_schemas` | List all schemas and their table counts in the specified HRL database. | `database` |
| `hrl_list_tables` | List tables in a specific schema with row counts and column counts. | `schema`, `database`, `filter` |
| `hrl_describe_table` | Get detailed column information for a specific table. | `table`, `schema`, `database` |
| `hrl_search_columns` | Search for columns matching a name pattern across all tables in a database. | `column_pattern`, `database`, `schema` |
| `hrl_get_relationships` | Get foreign key relationships for a table (both outgoing and incoming). | `table`, `schema`, `database` |
| `hrl_get_sample_data` | Get sample rows from a table to understand actual data values. | `table`, `schema`, `database`, `rows` |
| `hrl_topic_wip` | Get schema guide for Work In Process (WIP) analysis on HRL. | — |
| `hrl_topic_material_tracking` | Get schema guide for Material Trace & Movement analysis on HRL. | — |
| `hrl_topic_cycle_time` | Get schema guide for Cycle Time analysis on HRL. | — |
| `hrl_topic_resource_utilization` | Get schema guide for Equipment OEE & Utilization analysis on HRL. | — |
| `hrl_topic_downtime` | Get schema guide for Equipment Downtime & MTBF/MTTR analysis on HRL. | — |
| `hrl_topic_production_orders` | Get schema guide for Production Order Status analysis on HRL. | — |
| `hrl_topic_quality` | Get schema guide for Data Collection & Quality analysis on HRL. | — |
| `hrl_topic_throughput` | Get schema guide for Throughput & Yield analysis on HRL. | — |
| `hrl_topic_products` | Get schema guide for Product Catalog & Groups analysis on HRL. | — |
| `hrl_topic_facility` | Get schema guide for Facility & Area Hierarchy analysis on HRL. | — |

### Opcenter - Siemens

`https://rniju3wscb.execute-api.us-west-2.amazonaws.com/mcp` — backend: Opcenter SQL Server — **17 tools**

| Tool | Description | Arguments |
|---|---|---|
| `run_opc_query` | Execute a read-only T-SQL SELECT query against Opcenter SQL Server databases. | `sql`, `database`, `limit` |
| `opc_list_schemas` | List all schemas and their table counts in the specified Opcenter database. | `database` |
| `opc_list_tables` | List tables in a specific schema with row counts and column counts. | `schema`, `database`, `filter` |
| `opc_describe_table` | Get detailed column information for a specific table. | `table`, `schema`, `database` |
| `opc_search_columns` | Search for columns matching a name pattern across all tables in a database. | `column_pattern`, `database`, `schema` |
| `opc_get_relationships` | Get foreign key relationships for a table (both outgoing and incoming). | `table`, `schema`, `database` |
| `opc_get_sample_data` | Get sample rows from a table to understand actual data values. | `table`, `schema`, `database`, `rows` |
| `opc_topic_containers` | Get schema guide for Container/Lot Tracking (WIP) on Opcenter. | — |
| `opc_topic_movement_history` | Get schema guide for Container Movement & Trace analysis on Opcenter. | — |
| `opc_topic_workflow` | Get schema guide for Process Routes & Workflow Steps on Opcenter. | — |
| `opc_topic_equipment` | Get schema guide for Resources & Equipment Status on Opcenter. | — |
| `opc_topic_mfg_orders` | Get schema guide for Manufacturing Orders on Opcenter. | — |
| `opc_topic_transactions` | Get schema guide for Transaction History on Opcenter. | — |
| `opc_topic_quality` | Get schema guide for Data Collection & Quality analysis on Opcenter. | — |
| `opc_topic_products` | Get schema guide for Product Definitions on Opcenter. | — |
| `opc_topic_cycle_time` | Get schema guide for Cycle Time Analysis on Opcenter. | — |
| `opc_topic_employees` | Get schema guide for Employee Activity on Opcenter. | — |

### Opcenter - CoreSi

`https://bu6num9hr8.execute-api.us-west-2.amazonaws.com/mcp` — backend: AIMES SQL Server — **17 tools**

| Tool | Description | Arguments |
|---|---|---|
| `run_aimes_query` | Execute a read-only T-SQL SELECT query against AIMES SQL Server databases. | `sql`, `database`, `limit` |
| `aimes_list_schemas` | List all schemas and their table counts in the specified AIMES database. | `database` |
| `aimes_list_tables` | List tables in a specific schema with row counts and column counts. | `schema`, `database`, `filter` |
| `aimes_describe_table` | Get detailed column information for a specific table. | `table`, `schema`, `database` |
| `aimes_search_columns` | Search for columns matching a name pattern across all tables in a database. | `column_pattern`, `database`, `schema` |
| `aimes_get_relationships` | Get foreign key relationships for a table (both outgoing and incoming). | `table`, `schema`, `database` |
| `aimes_get_sample_data` | Get sample rows from a table to understand actual data values. | `table`, `schema`, `database`, `rows` |
| `aimes_topic_containers` | Get schema guide for Container/Lot Tracking (WIP) on AIMES. | — |
| `aimes_topic_movement_history` | Get schema guide for Container Movement & Trace analysis on AIMES. | — |
| `aimes_topic_workflow` | Get schema guide for Process Routes & Workflow Steps on AIMES. | — |
| `aimes_topic_equipment` | Get schema guide for Resources & Equipment Status on AIMES. | — |
| `aimes_topic_mfg_orders` | Get schema guide for Manufacturing Orders on AIMES. | — |
| `aimes_topic_transactions` | Get schema guide for Transaction History on AIMES. | — |
| `aimes_topic_quality` | Get schema guide for Data Collection & Quality analysis on AIMES. | — |
| `aimes_topic_products` | Get schema guide for Product Definitions on AIMES. | — |
| `aimes_topic_cycle_time` | Get schema guide for Cycle Time Analysis on AIMES. | — |
| `aimes_topic_employees` | Get schema guide for Employee Activity on AIMES. | — |

### Lumentum Server

`https://ocx3mhgaw5.execute-api.us-west-2.amazonaws.com/mcp` — backend: Opcenter Semi SQL Server — **17 tools**

| Tool | Description | Arguments |
|---|---|---|
| `run_semi_opc_query` | Execute a read-only T-SQL SELECT query against Opcenter Semi SQL Server databases. | `sql`, `database`, `limit` |
| `semi_opc_list_schemas` | List all schemas and their table counts in the specified Opcenter Semi database. | `database` |
| `semi_opc_list_tables` | List tables in a specific schema with row counts and column counts. | `schema`, `database`, `filter` |
| `semi_opc_describe_table` | Get detailed column information for a specific table. | `table`, `schema`, `database` |
| `semi_opc_search_columns` | Search for columns matching a name pattern across all tables in a database. | `column_pattern`, `database`, `schema` |
| `semi_opc_get_relationships` | Get foreign key relationships for a table (both outgoing and incoming). | `table`, `schema`, `database` |
| `semi_opc_get_sample_data` | Get sample rows from a table to understand actual data values. | `table`, `schema`, `database`, `rows` |
| `semi_opc_topic_containers` | Get schema guide for Container/Lot Tracking (WIP) on Opcenter Semi. | — |
| `semi_opc_topic_movement_history` | Get schema guide for Container Movement & Trace analysis on Opcenter Semi. | — |
| `semi_opc_topic_workflow` | Get schema guide for Process Routes & Workflow Steps on Opcenter Semi. | — |
| `semi_opc_topic_equipment` | Get schema guide for Resources & Equipment Status on Opcenter Semi. | — |
| `semi_opc_topic_mfg_orders` | Get schema guide for Manufacturing Orders on Opcenter Semi. | — |
| `semi_opc_topic_transactions` | Get schema guide for Transaction History on Opcenter Semi. | — |
| `semi_opc_topic_quality` | Get schema guide for Data Collection & Quality analysis on Opcenter Semi. | — |
| `semi_opc_topic_products` | Get schema guide for Product Definitions on Opcenter Semi. | — |
| `semi_opc_topic_cycle_time` | Get schema guide for Cycle Time Analysis on Opcenter Semi. | — |
| `semi_opc_topic_employees` | Get schema guide for Employee Activity on Opcenter Semi. | — |

### PSI Quantum

`https://fezokoagz5.execute-api.us-west-2.amazonaws.com/mcp` — backend: PSI Quantum stored-procedure catalog — **15 tools**

| Tool | Description | Arguments |
|---|---|---|
| `psiq_search_catalog` | Search the PSI Quantum stored procedure catalog by natural-language question. | `question` |
| `psiq_list_procedures` | List all stored procedures in the PSI Quantum catalog, optionally filtered by SP_Tool_Group. | `group` |
| `psiq_get_procedure_details` | Get full details for a specific stored procedure by Proc_ID. | `proc_id` |
| `psiq_execute_procedure` | Execute a stored procedure by Proc_ID from the PSI Quantum catalog. | `proc_id`, `params` |
| `psiq_dicing` | Dicing group: wafer dicing status, yield, blade usage, dicing recipes, and lot tracking. | `action`, `proc_id`, `params` |
| `psiq_die_prep` | Die Prep group: die sorting, visual inspection, die attach prep, ink marking, and die inventory. | `action`, `proc_id`, `params` |
| `psiq_material_location` | Material Location group: current material positions, warehouse locations, and material movement history. | `action`, `proc_id`, `params` |
| `psiq_mes_transaction` | MES Transaction group: manufacturing execution system transaction logs, move-in/move-out history, and audit trails. | `action`, `proc_id`, `params` |
| `psiq_pnp` | PNP (Pick and Place) group: component placement status, PNP machine throughput, placement accuracy, and job tracking. | `action`, `proc_id`, `params` |
| `psiq_post_fab` | Post-Fab group: post-fabrication inspection results, packaging status, final test outcomes, and yield analysis. | `action`, `proc_id`, `params` |
| `psiq_assembly_build` | Assembly Build group: assembly work orders, build progress, component consumption, sub-assembly tracking, and final assembly status. | `action`, `proc_id`, `params` |
| `psiq_shipping_vendor` | Shipping & Vendor group: shipment tracking, vendor purchase orders, incoming material receipts, and vendor quality metrics. | `action`, `proc_id`, `params` |
| `psiq_wafer_testing` | Wafer Testing & Metrology group: electrical test results, wafer probe data, metrology measurements, parametric test analysis, and test yield. | `action`, `proc_id`, `params` |
| `psiq_wafer_wip` | Wafer WIP & Inventory group: work-in-process tracking, wafer inventory levels, WIP aging, lot hold status, and inventory reconciliation. | `action`, `proc_id`, `params` |
| `psiq_base_report` | Base Report group: standard MES reports including completed containers, component issues, holds, dispatch, | `action`, `proc_id`, `params` |

### Bottleneck Analysis

`https://5f99aat4n5.execute-api.us-west-2.amazonaws.com/mcp` — backend: `Bottleneck_MCP` views + stored procedures — **9 tools**

| Tool | Description | Arguments |
|---|---|---|
| `get_instructions` | Returns the AI assistant's playbook for using this MCP server. | — |
| `get_topic_guide` | Returns rich descriptions for 31 bottleneck-analysis topics so the LLM can decide which one(s) fit the user's question. | `topic` |
| `get_response_format` | Return response-format guidance for a user prompt. | `prompt`, `topic` |
| `query` | Execute a read-only T-SQL SELECT query. | `sql`, `scope`, `limit`, `database` |
| `query_view` | [DEPRECATED v3.8 — use query(scope='curated')] Restricted to Bottleneck_MCP.vw_*. | `sql`, `limit` |
| `get_view_details` | One-stop schema introspection for views and stored procedures in Bottleneck_MCP. | `view_names` |
| `run_stored_procedure` | Execute one of 2 whitelisted Bottleneck_MCP stored procedures with typed parameters. | `procedure`, `params` |
| `list_parameter_values` | Get valid filter values for categorical columns - use before writing WHERE clauses. | `parameter_type` |
| `run_query` | [DEPRECATED v3.8 — use query(scope='raw')] Unrestricted SELECT, any schema. | `sql`, `database`, `limit` |

## Use-case map (Entegris' 7 requested capabilities)

| # | Use case | Tooling | Status |
|---|---|---|---|
| 1 | Material genealogy + hold/disposition | Genealogy server; `*_topic_material_tracking` | 🔴 server down; **write half has no tool** — every catalogued tool is read-only SELECT |
| 2 | Equipment OEE report | `*_topic_resource_utilization` ("Equipment OEE & Utilization") | 🟢 available |
| 3 | Scrap Pareto analysis | dedicated Scrap Pareto server | 🔴 server down |
| 4 | Bottleneck analysis | Bottleneck Analysis server (9 tools, 31 topics) | 🟢 available |
| 5 | Cycle time outlier detection | `*_topic_cycle_time` | 🟢 available |
| 6 | Operator performance analysis | `opc_topic_employees`, `aimes_topic_employees` | 🟡 Opcenter/AIMES only — no CMF or KSP equivalent |
| 7 | Overall facility performance | `*_topic_facility`, `*_topic_throughput` | 🟢 available |

Charting/graphing ("graphical report", "pareto") is not an MCP capability — it would be
produced by the model via the `code_execution` tool or an artifact, per
`lib/system-prompts.ts:65` ("Combine MCP with code execution and artifacts for analysis
and visualization pipelines").

## Findings

1. **Two of the ten servers are down**, and both back named use cases (genealogy, scrap
   Pareto). Nothing in either app surfaces this: a failed MCP load is caught and logged at
   `app/api/chat/route.ts:465`, and the system prompt forbids telling the user a data
   source failed (`lib/system-prompts.ts:73`, rule 4 at `:90`). A user asking for a scrap
   Pareto today gets a plain-language "couldn't retrieve that", with no operator alert.

2. **The endpoints are unauthenticated.** All 10 are seeded `authType: 'none'`, and all
   were reached from an ordinary laptop with no credentials. They expose arbitrary
   read-only T-SQL against production MES databases. The Bottleneck server additionally
   carries `run_query` — *"Unrestricted SELECT, any schema"* — marked deprecated but live.

3. **Use case 1 is only half-specified.** "Put on hold, disposition or otherwise" is a
   write to MES; every tool catalogued here is read-only. No hold/disposition tool exists
   on any live server.

4. **The repo's tool-count assumptions cannot be validated statically.** `available_tools`
   is populated only by discovery; until an operator runs it per connection, the chat route
   loads zero MCP tools and FabInsight answers from the base model alone.

## Open questions for the code owner

1. Are the Genealogy and Scrap Pareto Lambdas decommissioned, mid-deploy, or broken? Who
   monitors them? (Neither app alerts on an MCP server being down.)
2. Is `authType: 'none'` intended for production, or is these endpoints' protection meant
   to come from network placement? They are reachable from the public internet today.
3. Where do the Python MCP server sources live? (Blocking question #1 in
   [`07-signoff-tracker.md`](./07-signoff-tracker.md) §7.5 — these 10 URLs are the lead.)
4. Should the deprecated `run_query` / `query_view` tools on the Bottleneck server be
   removed, given the model can still select them?
5. Is a hold/disposition write tool planned for use case 1, and if so on which server?
6. Which of the 10 servers are actually assigned to roles in production
   (`mcp_connections`), versus merely seeded in the registry?

---

*Probed 2026-07-24 via read-only `tools/list`. No tool was executed and no MES data was
read. Argument schemas beyond parameter names are in the raw JSON captures.*
