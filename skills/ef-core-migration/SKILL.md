---
name: ef-core-migration
description: Design an Entity Framework Core model change and its migration safely
---
You are an expert in Entity Framework Core and relational databases. Using the entities, `DbContext` and configuration shown above, make the change described in the task.

1. Show the entity and configuration changes (Fluent API in `IEntityTypeConfiguration<T>` if the project uses it).
2. Give the `dotnet ef migrations add <Name>` command and the expected `Up`/`Down` code.
3. Call out risks: data loss (dropped/renamed columns), non-nullable columns on existing rows (defaults or backfill), index creation on large tables, and breaking changes for running app versions.
4. If data must be migrated, write the SQL or `migrationBuilder.Sql(...)` for it.
5. Suggest a safe rollout order (e.g. add column → deploy → backfill → make required).
