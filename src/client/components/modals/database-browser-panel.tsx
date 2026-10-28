import { Add01Icon, DatabaseImportIcon, MoreVerticalIcon, Refresh03Icon } from "@hugeicons/core-free-icons";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, type DatabaseColumn, type DatabaseDataImport, type DatabaseRow, type DatabaseRowFilter, type DatabaseRowsResponse, type DatabaseRuntimeState, type DatabaseSchema, type DatabaseTable } from "../../api";
import { Dropdown } from "../ui/dropdown";
import { AppIcon, shellButton } from "../ui/primitives";
import { DatabaseInsertSheet, validRedisType } from "./database-insert-sheet";
import { PostgresDataImportModal } from "./postgres-data-import-modal";
import { DatabaseTableGrid } from "./database-table-grid";
import { MongoDocumentList } from "./mongo-document-list";
import { MongoDocumentModal } from "./mongo-document-modal";
import { DatabaseImportStatusBanner } from "./database-import-status-banner";
import { DatabaseRuntimeStatePanel } from "./database-runtime-state-panel";
import { ConfirmationDialog } from "./confirmation-dialog";

function isPostgresFamilyDatabase(engine: string) {
  return engine === "postgres" || engine === "postgis" || engine === "timescale";
}

function rowValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function primaryKeyFor(columns: DatabaseColumn[], row: DatabaseRow) {
  const primaryColumns = columns.filter((column) => column.primaryKey);
  return Object.fromEntries(primaryColumns.map((column) => [column.name, row[column.name] ?? null]));
}

const rowCountFormatter = new Intl.NumberFormat();

function tableRowCountLabel(rowCount: number | null) {
  if (rowCount === null) return "unknown";
  return `${rowCountFormatter.format(rowCount)} row${rowCount === 1 ? "" : "s"}`;
}

function itemCountLabel(rowCount: number | null, engine: string) {
  if (rowCount === null) return "unknown";
  if (engine === "mongodb" || engine === "mongo") return `${rowCountFormatter.format(rowCount)} doc${rowCount === 1 ? "" : "s"}`;
  if (engine === "redis") return `${rowCountFormatter.format(rowCount)} item${rowCount === 1 ? "" : "s"}`;
  return tableRowCountLabel(rowCount);
}

function browserNouns(engine: string) {
  if (engine === "mongodb" || engine === "mongo") return { list: "Collections", group: "Database", empty: "No collections found.", scopedEmpty: "No collections in this database.", record: "document" };
  if (engine === "redis") return { list: "Keys", group: "Type", empty: "No keys found.", scopedEmpty: "No keys for this type.", record: "item" };
  return { list: "Tables", group: "Schema", empty: "No tables found.", scopedEmpty: "No tables in this schema.", record: "row" };
}

function databaseSchemaNames(schemas: DatabaseSchema[], tables: DatabaseTable[]) {
  return Array.from(new Set([
    ...schemas.map((schema) => schema.name),
    ...tables.map((table) => table.schema)
  ])).filter(Boolean);
}

export function DatabaseBrowserPanel({ serviceId, external = false }: { serviceId: string; external?: boolean }) {
  const [tables, setTables] = useState<DatabaseTable[]>([]);
  const [schemas, setSchemas] = useState<DatabaseSchema[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [rowsResult, setRowsResult] = useState<DatabaseRowsResponse | null>(null);
  const [supported, setSupported] = useState(true);
  const [editable, setEditable] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [insertError, setInsertError] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftRow, setDraftRow] = useState<Record<string, string>>({});
  const [insertOpen, setInsertOpen] = useState(false);
  const [insertDraft, setInsertDraft] = useState<Record<string, string>>({});
  const [appliedFilters, setAppliedFilters] = useState<DatabaseRowFilter[]>([]);
  const [pageSize, setPageSize] = useState(50);
  const [pageOffset, setPageOffset] = useState(0);
  const [selectedSchema, setSelectedSchema] = useState("");
  const [engine, setEngine] = useState("");
  const [runtimeState, setRuntimeState] = useState<DatabaseRuntimeState>("ready");
  const [mongoQuery, setMongoQuery] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [dataImports, setDataImports] = useState<DatabaseDataImport[]>([]);
  const [dismissedDataImportIds, setDismissedDataImportIds] = useState<Set<string>>(new Set());
  const [rowsPendingDelete, setRowsPendingDelete] = useState<DatabaseRow[]>([]);

  const columns = rowsResult?.columns ?? [];
  const rows = rowsResult?.rows ?? [];
  const hasPrimaryKey = columns.some((column) => column.primaryKey);
  const nouns = browserNouns(rowsResult?.engine ?? engine);
  const isRedis = engine === "redis";
  const isMongo = engine === "mongodb" || engine === "mongo";
  const canImportData = isPostgresFamilyDatabase(engine) && !external;
  const canAddDocument = isRedis || isMongo;
  const latestDataImport = dataImports[0] ?? null;
  const activeDataImport = dataImports.find((dataImport) => (
    (dataImport.status === "queued" || dataImport.status === "running") && !dismissedDataImportIds.has(dataImport.id)
  )) ?? null;
  const visibleDataImport = activeDataImport ?? (latestDataImport && !dismissedDataImportIds.has(latestDataImport.id) ? latestDataImport : null);
  const pendingDeleteCount = rowsPendingDelete.length;
  const pendingDeleteRecordLabel = `${nouns.record}${pendingDeleteCount === 1 ? "" : "s"}`;

  const selectedTableName = useMemo(() => {
    return tables.find((table) => table.id === selectedTable)?.name ?? selectedTable;
  }, [selectedTable, tables]);
  const selectedTableMeta = useMemo(() => {
    return tables.find((table) => table.id === selectedTable) ?? null;
  }, [selectedTable, tables]);
  const schemaOptions = useMemo(() => {
    return databaseSchemaNames(schemas, tables).map((schema) => ({ value: schema, label: schema }));
  }, [schemas, tables]);
  const visibleTables = useMemo(() => {
    if (!selectedSchema) return tables;
    return tables.filter((table) => table.schema === selectedSchema);
  }, [selectedSchema, tables]);

  function preferredSchema(nextSchemas: DatabaseSchema[], nextTables: DatabaseTable[], nextEngine: string) {
    const names = databaseSchemaNames(nextSchemas, nextTables);
    if (names.includes(selectedSchema)) return selectedSchema;
    if ((isPostgresFamilyDatabase(nextEngine) || nextEngine === "mysql" || nextEngine === "clickhouse") && names.includes("public")) return "public";
    return names[0] ?? "";
  }

  async function loadTables() {
    setBusy("tables");
    setError("");
    try {
      const result = await api.databaseTables(serviceId);
      setSupported(result.supported);
      setEditable(result.editable);
      setEngine(result.engine);
      setRuntimeState(result.runtimeState ?? "ready");
      setTables(result.tables);
      setSchemas(result.schemas ?? []);
      setMessage(result.message ?? "");
      const nextSchema = preferredSchema(result.schemas ?? [], result.tables, result.engine);
      const nextSelectedTable = result.tables.find((table) => table.id === selectedTable && table.schema === nextSchema)?.id
        ?? result.tables.find((table) => table.schema === nextSchema)?.id
        ?? "";
      setSelectedSchema(nextSchema);
      setSelectedTable(nextSelectedTable);
      if (!nextSelectedTable || (result.runtimeState && result.runtimeState !== "ready")) setRowsResult(null);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not load database tables");
    } finally {
      setBusy("");
    }
  }

  async function loadDataImports() {
    try {
      const result = await api.databaseDataImports(serviceId);
      setDataImports(result.imports);
    } catch {
      setDataImports([]);
    }
  }

  async function loadRows(table = selectedTable, filters = appliedFilters, offset = pageOffset, limit = pageSize) {
    if (!table) return;
    setBusy("rows");
    setError("");
    try {
      const result = await api.databaseRows(serviceId, table, limit, offset, filters);
      setRowsResult(result);
      setEngine(result.engine);
      setEditable(result.editable);
      setPageSize(result.limit);
      setPageOffset(result.offset);
      setEditingIndex(null);
      setInsertOpen(false);
      setInsertError("");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not load table rows");
    } finally {
      setBusy("");
    }
  }

  function adjustTableRowCount(tableId: string, delta: number) {
    setTables((current) => current.map((table) => (
      table.id === tableId && table.rowCount !== null
        ? { ...table, rowCount: Math.max(0, table.rowCount + delta) }
        : table
    )));
  }

  function insertTitle() {
    if (isRedis) return selectedTable ? "Add item" : "Add key";
    if (isMongo) return selectedTable ? "Add document" : "Add collection";
    return "Insert row";
  }

  function insertButtonLabel() {
    if (isRedis) return selectedTable ? "Add item" : "Add key";
    if (isMongo) return "Add document";
    return "Insert";
  }

  function openInsertSheet() {
    if (isRedis) {
      const type = selectedTableMeta?.schema && selectedTableMeta.schema !== "none"
        ? selectedTableMeta.schema
        : selectedSchema || "string";
      setInsertDraft({
        key: selectedTable ? selectedTableName : "",
        type: validRedisType(type) ? type : "string",
        field: "",
        member: "",
        score: "0",
        value: "",
        ttl: ""
      });
    } else if (isMongo) {
      setInsertDraft({
        database: selectedTableMeta?.schema || selectedSchema || "aeroplane",
        collection: selectedTable ? selectedTableName : "",
        document: "{\n  \"name\": \"example\"\n}"
      });
    } else {
      setInsertDraft(Object.fromEntries(columns.map((column) => [column.name, ""])));
    }
    setInsertError("");
    setInsertOpen(true);
  }

  function changeSchema(schema: string) {
    setSelectedSchema(schema);
    setSelectedTable(tables.find((table) => table.schema === schema)?.id ?? "");
    setRowsResult(null);
    setAppliedFilters([]);
    setMongoQuery("");
    setPageOffset(0);
  }

  useEffect(() => {
    setSelectedTable("");
    setSelectedSchema("");
    setSchemas([]);
    setEngine("");
    setRuntimeState("ready");
    setRowsResult(null);
    setAppliedFilters([]);
    setMongoQuery("");
    setOptionsOpen(false);
    setImportOpen(false);
    setRowsPendingDelete([]);
    setDataImports([]);
    setDismissedDataImportIds(new Set());
    setPageOffset(0);
    void loadTables();
    void loadDataImports();
  }, [serviceId]);

  useEffect(() => {
    const activeImport = dataImports.some((dataImport) => dataImport.status === "queued" || dataImport.status === "running");
    if (!activeImport) return;

    const interval = window.setInterval(() => {
      void loadDataImports();
    }, 2500);

    return () => window.clearInterval(interval);
  }, [dataImports, serviceId]);

  useEffect(() => {
    if (selectedTable) {
      setAppliedFilters([]);
      setMongoQuery("");
      setRowsPendingDelete([]);
      setPageOffset(0);
      void loadRows(selectedTable, [], 0, pageSize);
    }
  }, [selectedTable]);

  function applyMongoQuery(filters: DatabaseRowFilter[], source: string) {
    if (!selectedTable) return;
    setError("");
    setMongoQuery(source);
    setAppliedFilters(filters);
    setPageOffset(0);
    void loadRows(selectedTable, filters, 0, pageSize);
  }

  function clearMongoQuery() {
    if (!selectedTable) return;
    setMongoQuery("");
    setAppliedFilters([]);
    setPageOffset(0);
    void loadRows(selectedTable, [], 0, pageSize);
  }

  async function refreshAfterImport() {
    setSelectedTable("");
    setRowsResult(null);
    setAppliedFilters([]);
    setMongoQuery("");
    setPageOffset(0);
    await loadDataImports();
    await loadTables();
  }

  function beginEdit(index: number) {
    const row = rows[index];
    setEditingIndex(index);
    setDraftRow(Object.fromEntries(columns.map((column) => [column.name, rowValue(row[column.name])])));
  }

  async function saveEdit(row: DatabaseRow) {
    if (!rowsResult || editingIndex === null) return;
    setBusy("edit");
    setError("");
    try {
      await api.updateDatabaseRow(serviceId, {
        table: rowsResult.table,
        primaryKey: primaryKeyFor(columns, row),
        values: draftRow
      });
      await loadRows(rowsResult.table, appliedFilters, pageOffset, pageSize);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not save row");
    } finally {
      setBusy("");
    }
  }

  function requestDeleteRows(rowsToDelete: DatabaseRow[]) {
    if (!rowsResult || rowsToDelete.length === 0) return;
    setRowsPendingDelete(rowsToDelete);
  }

  async function deletePendingRows() {
    const currentRowsResult = rowsResult;
    const rowsToDelete = rowsPendingDelete;
    if (!currentRowsResult || rowsToDelete.length === 0) return;

    setRowsPendingDelete([]);
    setBusy("delete");
    setError("");
    try {
      for (const row of rowsToDelete) {
        await api.deleteDatabaseRow(serviceId, {
          table: currentRowsResult.table,
          primaryKey: primaryKeyFor(columns, row)
        });
      }
      const nextOffset = rowsToDelete.length >= rows.length ? Math.max(0, pageOffset - pageSize) : pageOffset;
      adjustTableRowCount(currentRowsResult.table, -rowsToDelete.length);
      await loadRows(currentRowsResult.table, appliedFilters, nextOffset, pageSize);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not delete selected rows");
    } finally {
      setBusy("");
    }
  }

  async function saveMongoDocument(row: DatabaseRow, document: string) {
    if (!rowsResult) return;
    setBusy("edit");
    setError("");
    try {
      await api.updateDatabaseRow(serviceId, {
        table: rowsResult.table,
        primaryKey: primaryKeyFor(columns, row),
        values: { document }
      });
      await loadRows(rowsResult.table, appliedFilters, pageOffset, pageSize);
    } catch (issue) {
      const message = issue instanceof Error ? issue.message : "Could not save document";
      setError(message);
      throw new Error(message);
    } finally {
      setBusy("");
    }
  }

  async function deleteMongoDocument(row: DatabaseRow) {
    if (!rowsResult) return;
    setBusy("delete");
    setError("");
    try {
      await api.deleteDatabaseRow(serviceId, {
        table: rowsResult.table,
        primaryKey: primaryKeyFor(columns, row)
      });
      const nextOffset = rows.length <= 1 ? Math.max(0, pageOffset - pageSize) : pageOffset;
      adjustTableRowCount(rowsResult.table, -1);
      await loadRows(rowsResult.table, appliedFilters, nextOffset, pageSize);
    } catch (issue) {
      const message = issue instanceof Error ? issue.message : "Could not delete document";
      setError(message);
      throw new Error(message);
    } finally {
      setBusy("");
    }
  }

  async function insertRow(event: FormEvent) {
    event.preventDefault();
    if (!rowsResult && !canAddDocument) return;
    setBusy("insert");
    setInsertError("");
    try {
      const table = rowsResult?.table ?? (selectedTable || "__new__");
      const result = await api.insertDatabaseRow(serviceId, {
        table,
        values: insertDraft
      });
      setInsertOpen(false);

      if (canAddDocument) {
        await loadTables();
        const nextTable = result.table ?? (table === "__new__" ? "" : table);
        if (nextTable) {
          if (nextTable === selectedTable) {
            await loadRows(nextTable, [], 0, pageSize);
          } else {
            setSelectedTable(nextTable);
          }
        }
      } else if (rowsResult) {
        adjustTableRowCount(rowsResult.table, 1);
        await loadRows(rowsResult.table, appliedFilters, pageOffset, pageSize);
      }
    } catch (issue) {
      setInsertError(issue instanceof Error ? issue.message : "Could not insert row");
    } finally {
      setBusy("");
    }
  }

  if (!supported) {
    return (
      <div className="border border-zinc-800 bg-zinc-950/45 p-6">
        <h3 className="font-hero text-lg text-zinc-100">Database browser unavailable</h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{message}</p>
      </div>
    );
  }

  const hasRuntimeNotice = runtimeState !== "ready";

  return (
    <div className="flex h-full min-h-0 gap-4">
      <aside className="flex min-h-0 w-64 flex-none flex-col overflow-hidden border border-zinc-800 bg-zinc-950/45">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">{nouns.list}</div>
          <button type="button" className="text-zinc-400 hover:text-zinc-100" onClick={() => void loadTables()} disabled={busy === "tables"} aria-label="Refresh tables">
            <AppIcon icon={Refresh03Icon} size={15} className={busy === "tables" ? "animate-spin" : ""} />
          </button>
        </div>
        <div className="border-b border-zinc-800 p-3">
          <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{nouns.group}</div>
          <Dropdown
            value={selectedSchema}
            options={schemaOptions}
            onChange={changeSchema}
            disabled={schemaOptions.length === 0 || busy === "tables"}
            placeholder={`Select ${nouns.group.toLowerCase()}`}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {busy === "tables" ? (
            <div className="flex h-full items-center justify-center px-4 py-5 text-center text-sm text-zinc-500">Loading...</div>
          ) : hasRuntimeNotice ? (
            <div className="flex h-full items-center justify-center px-4 py-5 text-center text-sm text-zinc-500">Database not ready.</div>
          ) : schemaOptions.length === 0 ? (
            <div className="flex h-full items-center justify-center px-4 py-5 text-center text-sm text-zinc-500">{nouns.empty}</div>
          ) : visibleTables.length === 0 ? (
            <div className="flex h-full items-center justify-center px-4 py-5 text-center text-sm text-zinc-500">{nouns.scopedEmpty}</div>
          ) : visibleTables.map((table) => (
            <button
              key={table.id}
              type="button"
              className={`block w-full border-b border-zinc-900 px-4 py-3 text-left text-sm ${selectedTable === table.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-300 hover:bg-zinc-900"}`}
              onClick={() => setSelectedTable(table.id)}
            >
              <span className="block truncate font-medium">{table.name}</span>
              <span className="mt-1 flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                <span className="min-w-0 truncate">{table.schema}</span>
                <span className="shrink-0 text-zinc-400">{itemCountLabel(table.rowCount, engine)}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
          <div>
            <h3 className="font-hero text-xl text-zinc-100">{selectedTableName || "Data"}</h3>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              {rowsResult
                ? `${rowCountFormatter.format(rowsResult.totalRows)} total ${nouns.record}${rowsResult.totalRows === 1 ? "" : "s"}`
                : `${rowCountFormatter.format(rows.length)} loaded ${nouns.record}${rows.length === 1 ? "" : "s"}`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canAddDocument ? (
              <button type="button" className={`${shellButton("primary")} h-9 !py-0`} onClick={openInsertSheet} disabled={busy === "insert"}>
                <AppIcon icon={Add01Icon} size={15} />
                {insertButtonLabel()}
              </button>
            ) : null}
            <button type="button" className={`${shellButton("ghost")} h-9 !py-0`} onClick={() => void loadRows(selectedTable, appliedFilters, pageOffset, pageSize)} disabled={!selectedTable || busy === "rows"}>
              <AppIcon icon={Refresh03Icon} size={15} className={busy === "rows" ? "animate-spin" : ""} />
              Refresh
            </button>
            {canImportData ? (
              <div className="relative">
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center border border-zinc-800 bg-zinc-900/70 text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
                  onClick={() => setOptionsOpen((current) => !current)}
                  aria-label="Data options"
                >
                  <AppIcon icon={MoreVerticalIcon} size={17} />
                </button>
                {optionsOpen ? (
                  <div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 w-52 border border-zinc-700 bg-zinc-900 shadow-[0_20px_40px_rgba(0,0,0,0.35)]">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-200 transition hover:bg-zinc-800 hover:text-white"
                      onClick={() => {
                        setOptionsOpen(false);
                        setImportOpen(true);
                      }}
                    >
                      <AppIcon icon={DatabaseImportIcon} size={15} />
                      Import data
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {visibleDataImport ? (
          <DatabaseImportStatusBanner
            dataImport={visibleDataImport}
            onDismiss={() => setDismissedDataImportIds((current) => new Set(current).add(visibleDataImport.id))}
          />
        ) : null}
        {error ? <div className="mb-4 border border-rose-500/30 bg-rose-950/25 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
        {!hasPrimaryKey && editable && rows.length > 0 ? (
          <div className="mb-4 border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-xs text-amber-200">
            Editing and deleting require a primary key on this table.
          </div>
        ) : null}

        {hasRuntimeNotice ? (
          <DatabaseRuntimeStatePanel
            state={runtimeState}
            message={message}
            busy={busy === "tables"}
            onRefresh={() => void loadTables()}
          />
        ) : !rowsResult ? (
          <div className="flex min-h-0 flex-1 items-center justify-center border border-zinc-800 bg-zinc-950/45 px-5 py-8 text-center text-sm text-zinc-500">
            {busy ? "Loading data..." : `Choose ${engine === "redis" ? "a key" : engine === "mongodb" || engine === "mongo" ? "a collection" : "a table"} to inspect ${nouns.record}s.`}
          </div>
        ) : isMongo ? (
          <MongoDocumentList
            columns={columns}
            rows={rows}
            busy={busy}
            scopeLabel={`${selectedSchema || selectedTableMeta?.schema || "mongo"}.${selectedTableName || "collection"}`}
            query={mongoQuery}
            pagination={{
              limit: rowsResult.limit,
              offset: rowsResult.offset,
              totalRows: rowsResult.totalRows,
              recordLabel: nouns.record,
              onPageChange: (offset) => {
                setPageOffset(offset);
                void loadRows(rowsResult.table, appliedFilters, offset, rowsResult.limit);
              },
              onPageSizeChange: (limit) => {
                setPageSize(limit);
                setPageOffset(0);
                void loadRows(rowsResult.table, appliedFilters, 0, limit);
              }
            }}
            onQueryChange={setMongoQuery}
            onFind={applyMongoQuery}
            onClearQuery={clearMongoQuery}
            onSaveDocument={saveMongoDocument}
            onDeleteDocument={deleteMongoDocument}
          />
        ) : columns.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center border border-zinc-800 bg-zinc-950/45 px-5 py-8 text-center text-sm text-zinc-500">
            {busy ? "Loading data..." : `Choose ${engine === "redis" ? "a key" : "a table"} to inspect ${nouns.record}s.`}
          </div>
        ) : (
          <DatabaseTableGrid
            columns={columns}
            rows={rows}
            editable={editable}
            hasPrimaryKey={hasPrimaryKey}
            busy={busy}
            editingIndex={editingIndex}
            draftRow={draftRow}
            appliedFilters={appliedFilters}
            pagination={{
              limit: rowsResult.limit,
              offset: rowsResult.offset,
              totalRows: rowsResult.totalRows,
              recordLabel: nouns.record,
              onPageChange: (offset) => {
                setPageOffset(offset);
                void loadRows(rowsResult.table, appliedFilters, offset, rowsResult.limit);
              },
              onPageSizeChange: (limit) => {
                setPageSize(limit);
                setPageOffset(0);
                void loadRows(rowsResult.table, appliedFilters, 0, limit);
              }
            }}
            onAddRecord={openInsertSheet}
            onBeginEdit={beginEdit}
            onCancelEdit={() => setEditingIndex(null)}
            onDeleteRows={requestDeleteRows}
            onDraftChange={(column, value) => setDraftRow((current) => ({ ...current, [column]: value }))}
            onApplyFilters={(filters) => {
              setAppliedFilters(filters);
              setPageOffset(0);
              void loadRows(rowsResult?.table ?? selectedTable, filters, 0, pageSize);
            }}
            onSaveEdit={(row) => void saveEdit(row)}
          />
        )}

        {insertOpen && isMongo ? (
          <MongoDocumentModal
            title={insertTitle()}
            subtitle={selectedTableName || nouns.list}
            buttonLabel={insertButtonLabel()}
            draft={insertDraft}
            error={insertError}
            busy={busy}
            onDraftChange={setInsertDraft}
            onSubmit={insertRow}
            onClose={() => {
              setInsertOpen(false);
              setInsertError("");
            }}
          />
        ) : null}

        {insertOpen && !isMongo ? (
          <DatabaseInsertSheet
            engine={engine}
            title={insertTitle()}
            subtitle={selectedTableName || nouns.list}
            buttonLabel={insertButtonLabel()}
            columns={columns}
            draft={insertDraft}
            error={insertError}
            busy={busy}
            onDraftChange={setInsertDraft}
            onSubmit={insertRow}
            onClose={() => {
              setInsertOpen(false);
              setInsertError("");
            }}
          />
        ) : null}
        <PostgresDataImportModal
          open={importOpen}
          serviceId={serviceId}
          onClose={() => setImportOpen(false)}
          onImported={refreshAfterImport}
        />
        <ConfirmationDialog
          open={pendingDeleteCount > 0}
          title={`Delete ${pendingDeleteCount} selected ${pendingDeleteRecordLabel}?`}
          subject={selectedTableName}
          description={`This will permanently remove the selected ${pendingDeleteRecordLabel} from this table.`}
          confirmLabel={`Delete ${pendingDeleteCount}`}
          busy={busy === "delete"}
          onClose={() => setRowsPendingDelete([])}
          onConfirm={deletePendingRows}
        />
      </section>
    </div>
  );
}
