# legal-agent

## Architecture & design decisions

A legal-domain RAG chatbot built on hybrid retrieval: lexical, semantic, and graph search combined, driven by an LLM agent rather than a fixed pipeline.

**Target architecture:**

```text
Retrieval:       OpenSearch (BM25) + ChromaDB (semantic) + Neo4j (KG)
Orchestration:   LLM agent with tool-calling, query rewriting, memory
Fusion:          RRF + optional cross-encoder re-ranking
Freshness:       Scoped web search (official/government domains only)
Source of truth: PostgreSQL (metadata, access control, app state)
```

**Why these three retrieval engines, and why they stay separate:**

- **OpenSearch over Elasticsearch** for BM25 — Apache 2.0 licensed (Elasticsearch is SSPL), otherwise equivalent for this use case.
- **ChromaDB** for semantic/vector search, kept as its own service rather than folded into Neo4j's vector index. Neo4j can do vector search + graph traversal in one Cypher query, but ChromaDB is lighter and better at pre-filtering — worth the extra service since ops complexity isn't a major constraint here.
- **Neo4j** for the knowledge graph, to capture entity relationships neither BM25 nor vector search surface. Built via **NER (entity extraction)** as the required first step — the graph's equivalent of embedding for vector search, transforming raw text into the representation the index understands (entity nodes vs. vectors), at both index and query time. Graph construction uses **LLMGraphTransformer (LangChain)** or **Microsoft GraphRAG**, which is why APOC is enabled; GDS is enabled for graph algorithms (community detection, centrality, similarity) if the agent needs them later.
- Results from OpenSearch + ChromaDB are merged via **Reciprocal Rank Fusion (RRF)**.

**Database boundaries** (why none of the three search engines is the primary datastore):

- **OpenSearch** is not a transactional DB — no ACID, no real joins, near-real-time not real-time. It's a read-optimized index fed by CDC from the source-of-truth DB.
- **OpenSearch vs. MongoDB**: both store JSON, but OpenSearch explodes documents into an inverted index (search-optimized, expensive writes); MongoDB stores documents intact (CRUD-optimized, cheap in-place updates).
- **Neo4j vs. PostgreSQL**: Neo4j is only a good *primary* store where relationships are the query itself (fraud detection, recommendations, knowledge graphs). For tabular/CRUD workloads, Postgres wins on tooling, cost, and scaling. Postgres is the source of truth for legal documents, metadata, and access control (provisioned — see [Infrastructure](#infrastructure-source-of-truth--3-search-engines) — CDC not yet built).

**Cross-store consistency, for a legal document specifically:** given a document in Postgres, the three targets aren't mirrors of each other — each needs a different projection, which changes what "consistent" means per target:

- **OpenSearch**: genuinely 1:1 — the indexed JSON should match the Postgres content exactly. A CDC tool can handle this as a near-real-time mechanical sync, no transformation logic needed.
- **ChromaDB**: chunked along the document's own legal structure (Article / Section / Clause, not fixed token windows), so a retrieved chunk stays citable. Each chunk needs a stable ID and content hash so re-embedding on edit only touches what changed, not the whole document.
- **Neo4j**: most legislative relationships (citations, amendments, "Căn cứ..." legal-basis references) are extractable *deterministically* via parsing at ingest, not just NER/LLM extraction — see the relationship taxonomy in [DATABASE_DESIGN.md §2](DATABASE_DESIGN.md#2-neo4j-graph--hierarchy--relationships-between-legislation). LLM-based extraction (LLMGraphTransformer/GraphRAG) is reserved for implicit relationships parsing can't catch. Notably, this isn't purely a function of the changed document: a *new* law referencing an *existing* one creates an edge that touches an already-synced document's graph neighborhood.

Because chunking+embedding and entity extraction are real (LLM) compute, not instant copies, true synchronous consistency across all four stores isn't achievable or the goal. The design is **traceable eventual consistency**: a per-document `content_version`, a `document_sync_state(document_id, target, synced_version, status)` table as the ground truth for "is X actually in sync," and a reconciliation job that re-fires sync for anything stale — so every derived store stays verifiably caught-up-or-known-stale, and is rebuildable from Postgres at any time. CDC transport choice leans toward **Debezium Server** (WAL-based capture, no full Kafka cluster) over Debezium+Kafka Connect, since ChromaDB's projector requires custom embedding code regardless of transport, and Neo4j's projector needs custom Cypher/citation-resolution logic either way — the ready-made sink connectors that justify running full Kafka Connect mainly help OpenSearch, which is the cheapest leg of this anyway.

**Agentic RAG, not a fixed pipeline:** lexical/semantic/graph search are exposed as tools an LLM agent selects, chains, and evaluates dynamically rather than always running all three — enabling multi-step reasoning and self-correction, at the cost of higher latency (mitigate via streaming intermediate steps over SSE).

**Web search is supplementary, not primary:** curated RAG wins over live web search on citation precision, reproducibility, and audit trail — critical for a legal use case. Web search is scoped narrowly as a freshness-check tool restricted to official/government domains, never as a primary citation source.

**Sequencing:** infra is being built incrementally — the 3 search engines (done), then Postgres as source of truth (done, provisioned with no CDC wired up yet), then CDC + sync-state + reconciliation, then the agent/orchestration layer.

## Data model (proposed)

**Status: proposal, not yet implemented.** Full schema design for all four stores — Postgres, OpenSearch, Neo4j, and the vector store — lives in **[DATABASE_DESIGN.md](DATABASE_DESIGN.md)**, kept in one file since they're meant to stay derivable from each other rather than designed independently. Covers the Postgres relational schema (`document`, `document_node`, `document_reference`, ...), the Neo4j graph model for legislative hierarchy and amendment relationships, the OpenSearch projection (in progress), and ChromaDB vs. ClickHouse as vector-store options (ClickHouse under evaluation given the team's existing footprint there).

## CDC pipeline (proposed)

**Status: proposal, not yet implemented.** No CDC infra exists in this repo yet.

**Transport: Debezium Server** (not full Debezium + Kafka Connect). Debezium Server reads the Postgres WAL via logical decoding — the same reliable, replay-capable capture engine full Debezium uses — but streams straight to a lighter sink instead of requiring a Kafka + Zookeeper/KRaft + Kafka Connect cluster. The main reason to run full Kafka Connect is its ready-made sink connectors, and those mostly help OpenSearch (the cheapest leg here anyway); ChromaDB and Neo4j need custom projector logic regardless of transport, so the extra Kafka operational cost doesn't buy much.

**Consistency model: traceable eventual consistency, not synchronous.** Chunking+embedding (ChromaDB) and entity extraction (Neo4j) are real compute — an embedding-model call and an LLM call respectively — not instant copies, so synchronous consistency across all four stores isn't the goal. Instead:

1. Every `document`/`document_node` write bumps `content_version` (a content hash).
2. Debezium Server emits a `document_changed(document_id, node_id, content_version)` event per change.
3. Three independent projectors consume it, each writing its own row in `document_sync_state` when done:
   - **OpenSearch indexer** — genuinely 1:1: map the row to JSON, `PUT` it. No transformation logic, near-real-time. The cheapest, fastest projector.
   - **ChromaDB chunker/embedder** — chunk boundaries are `document_node` rows directly, not re-derived by splitting text. Diffs each node's `content_hash` against what was last embedded; only re-embeds what changed. Upserts with deterministic IDs (`document_id:path`) so retries are idempotent, and deletes chunks whose node no longer exists.
   - **Neo4j graph projector** — `MERGE`s `:Document`/`:Provision` nodes and typed edges (`MODIFIES`, `CITES`, `IMPLEMENTS`, `CONSOLIDATES` — see [DATABASE_DESIGN.md §2](DATABASE_DESIGN.md#2-neo4j-graph--hierarchy--relationships-between-legislation)) keyed on `citation_id`/`node_key` (stable, human-legible legal identifiers, not Postgres PKs). Deterministic edges translate straight from `document_reference` rows populated at ingest (citation + "Căn cứ..." preamble parsing, no LLM needed); LLM/NER (LLMGraphTransformer/GraphRAG) only runs for implicit relationships not already captured deterministically. Must also handle a *new* document creating an edge into an *already-synced* document's graph neighborhood — not purely a function of the changed document.
4. A **reconciliation job** periodically scans `document_sync_state` for `synced_version < content_version` or `status = failed` and re-fires sync. This is what actually delivers a correctness guarantee in a domain where a stale index citing outdated legislation is a real risk, not just a UX nuisance — and it makes every derived store rebuildable from Postgres on demand.

**Vietnamese-text implementation notes** (relevant once this gets built): Postgres's built-in `tsvector` has no Vietnamese dictionary — not a blocker since Postgres isn't doing full-text ranking here, but the **OpenSearch indexer** will need a Vietnamese-aware analyzer (ICU tokenizer or a dedicated Vietnamese analysis plugin) rather than the default English analyzer. The embedding model chosen for the **ChromaDB projector** needs genuine Vietnamese-language support, not just multilingual tokenization.

## Infrastructure: source of truth + 3 search engines

The retrieval layer runs three engines side by side, each covering a different retrieval strategy, backed by Postgres as the source of truth:

| Engine | Role | Port(s) |
| - | - | - |
| Postgres | Source of truth (documents, metadata, access control) | 5432 |
| OpenSearch | BM25 / lexical keyword search | 9200 (API), 9600 (perf), 5601 (Dashboards UI) |
| ChromaDB | Semantic / vector search | 8000 |
| Neo4j | Knowledge graph | 7474 (browser UI), 7687 (bolt) |

Postgres holds the canonical document content; OpenSearch, ChromaDB, and Neo4j are derived read views kept in sync from it (via CDC — not yet built, see [CDC pipeline (proposed)](#cdc-pipeline-proposed)). No CDC pipeline exists yet, so writes to Postgres do **not** currently propagate anywhere.

### Setup

1. Copy `.env.example` to `.env` and set strong passwords:

   ```sh
   cp .env.example .env
   ```

2. Start the stack:

   ```sh
   docker compose up -d
   ```

3. Check status:

   ```sh
   docker compose ps
   ```

   All services should report `healthy` within ~60s of startup.

### Verifying each engine

- **Postgres**: `docker exec legal-agent-postgres psql -U legal_agent -d legal_agent -c "SELECT version();"`
- **OpenSearch**: `curl -sku admin:<OPENSEARCH_ADMIN_PASSWORD> https://localhost:9200/_cluster/health`
  Dashboards UI at [http://localhost:5601](http://localhost:5601) (login `admin` / your password).
- **ChromaDB**: `curl http://localhost:8000/api/v2/heartbeat`
- **Neo4j**: Browser UI at [http://localhost:7474](http://localhost:7474) (login `neo4j` / your `NEO4J_PASSWORD`). Bolt endpoint at `bolt://localhost:7687`.

### Configuration reference

Explanation of every non-obvious key in `docker-compose.yml`, per service.

#### `postgres`

| Key | Purpose | Docs |
| - | - | - |
| `image: postgres:17.10-alpine` | Pinned exact version, Alpine variant for a smaller image. Resolved from the `17-alpine` tag at setup time. | [Official image docs](https://hub.docker.com/_/postgres) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Creates this user/database on first start only (same one-time-bootstrap caveat as `OPENSEARCH_INITIAL_ADMIN_PASSWORD` and `NEO4J_AUTH` above — see the password-change sections below for the general pattern, though Postgres's own fix is simpler: `ALTER USER ... PASSWORD` over `psql`). | [Official image docs](https://hub.docker.com/_/postgres) |
| `volumes: postgres-data:/var/lib/postgresql/data` | Persists all databases/tables to a named volume. | [Compose volumes](https://docs.docker.com/reference/compose-file/volumes/) |
| `ports: 5432` | Postgres's default port. | [Official image docs](https://hub.docker.com/_/postgres) |
| `healthcheck` | Uses `pg_isready`, the standard Postgres liveness/readiness probe — checks the server accepts connections for the given user/db. | [`pg_isready` docs](https://www.postgresql.org/docs/current/app-pg-isready.html) |

#### `opensearch`

| Key | Purpose | Docs |
| - | - | - |
| `image: opensearchproject/opensearch:2.19.1` | Pinned version instead of `latest`, so a `docker compose pull` doesn't silently change cluster behavior. | [Docker install guide](https://opensearch.org/docs/latest/install-and-configure/install-opensearch/docker/) |
| `cluster.name` | Logical cluster identifier; nodes only join a cluster if this matches. | [Important settings](https://opensearch.org/docs/latest/install-and-configure/important-settings/) |
| `node.name` | Human-readable name for this node, shown in cluster health/stats output. | [Important settings](https://opensearch.org/docs/latest/install-and-configure/important-settings/) |
| `discovery.type=single-node` | Skips the cluster-formation/quorum process — required for a 1-node dev cluster, otherwise OpenSearch waits forever to discover peers that don't exist. | [Important settings](https://opensearch.org/docs/latest/install-and-configure/important-settings/) |
| `bootstrap.memory_lock=true` | Locks the JVM heap in physical RAM so it's never swapped to disk (swapping kills search latency). Requires the `memlock` ulimit below. | [Important settings](https://opensearch.org/docs/latest/install-and-configure/important-settings/) |
| `OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m` | Sets JVM initial/max heap explicitly. Min and max are set equal to avoid heap resizing pauses. Kept small for a laptop dev box. | [Important settings](https://opensearch.org/docs/latest/install-and-configure/important-settings/) |
| `OPENSEARCH_INITIAL_ADMIN_PASSWORD` | Required since OpenSearch 2.12 — the security plugin refuses to start without an explicit admin password (no more default `admin/admin`). | [Security demo configuration](https://opensearch.org/docs/latest/security/configuration/demo-configuration/) |
| `ulimits.memlock` | OS-level limit that must be raised to `-1` (unlimited) for `bootstrap.memory_lock` to actually succeed inside the container. | [Docker install guide](https://opensearch.org/docs/latest/install-and-configure/install-opensearch/docker/#important-settings) |
| `ulimits.nofile` | Raises max open file descriptors — Lucene (OpenSearch's storage engine) holds many file handles per index/segment. | [Docker install guide](https://opensearch.org/docs/latest/install-and-configure/install-opensearch/docker/#important-settings) |
| `volumes: opensearch-data:/usr/share/opensearch/data` | Persists indices to a named volume so data survives container recreation. | [Compose volumes](https://docs.docker.com/reference/compose-file/volumes/) |
| `ports: 9200, 9600` | `9200` = REST/search API; `9600` = Performance Analyzer plugin API. | [Important settings](https://opensearch.org/docs/latest/install-and-configure/important-settings/) |
| `healthcheck` | Polls the [Cluster Health API](https://opensearch.org/docs/latest/api-reference/cluster-api/cluster-health/) and passes on `green` or `yellow` (yellow is normal/expected for single-node, since replica shards can never be assigned). `start_period: 60s` gives the JVM time to boot before failures count. | [Compose `healthcheck`](https://docs.docker.com/reference/compose-file/services/#healthcheck) |

#### `opensearch-dashboards`

| Key | Purpose | Docs |
| - | - | - |
| `image` | Version-matched to the `opensearch` service — Dashboards and the cluster it talks to should stay on the same major.minor. | [Dashboards Docker guide](https://opensearch.org/docs/latest/install-and-configure/install-dashboards/docker/) |
| `OPENSEARCH_HOSTS` | Tells Dashboards which cluster endpoint(s) to connect to — here, the `opensearch` service by its Compose DNS name over the internal network. | [Dashboards Docker guide](https://opensearch.org/docs/latest/install-and-configure/install-dashboards/docker/#step-1-download-and-run-opensearch-dashboards) |
| `OPENSEARCH_USERNAME` / `OPENSEARCH_PASSWORD` | Credentials Dashboards uses server-side to query the cluster (separate from the credentials you log into the Dashboards UI with, though here both are `admin`). | [Dashboards Docker guide](https://opensearch.org/docs/latest/install-and-configure/install-dashboards/docker/) |
| `depends_on: opensearch: condition: service_healthy` | Blocks Dashboards from starting until OpenSearch's own healthcheck passes, instead of just waiting for the container to exist. | [Compose `depends_on`](https://docs.docker.com/reference/compose-file/services/#depends_on) |

#### `chromadb`

| Key | Purpose | Docs |
| - | - | - |
| `image: chromadb/chroma:0.5.20` | Pinned version of the official Chroma server image. | [Chroma Docker docs](https://docs.trychroma.com/production/containers/docker) |
| `IS_PERSISTENT=TRUE` | Tells the server to persist collections/embeddings to disk rather than running in-memory only. | [Chroma Docker docs](https://docs.trychroma.com/production/containers/docker) |
| `ANONYMIZED_TELEMETRY=FALSE` | Opts out of Chroma's anonymous usage telemetry. | [Chroma telemetry docs](https://docs.trychroma.com/docs/overview/telemetry) |
| `volumes: chromadb-data:/chroma/chroma` | Persists the on-disk vector store (Chroma's default data directory inside the container). | [Chroma Docker docs](https://docs.trychroma.com/production/containers/docker) |
| `ports: 8000` | Chroma's default HTTP API port. | [Chroma Docker docs](https://docs.trychroma.com/production/containers/docker) |
| `healthcheck` | Hits Chroma's heartbeat endpoint, which returns a nanosecond timestamp if the server is alive. | [Chroma API reference](https://docs.trychroma.com/reference/python/client#heartbeat) |

#### `neo4j`

| Key | Purpose | Docs |
| - | - | - |
| `image: neo4j:5.26-community` | Pinned Community Edition — sufficient here since nothing in the plan needs Enterprise features (clustering, RBAC, hot backups). | [Neo4j Docker docs](https://neo4j.com/docs/operations-manual/current/docker/introduction/) |
| `NEO4J_AUTH=neo4j/${NEO4J_PASSWORD}` | Sets the initial username/password (format `user/pass`); Neo4j refuses to start with no auth unless explicitly disabled. | [Docker configuration](https://neo4j.com/docs/operations-manual/current/docker/configuration/#docker-auth) |
| `NEO4J_PLUGINS=["apoc","graph-data-science"]` | Auto-downloads and enables the APOC (general graph procedures, used by GraphRAG-style construction) and GDS (graph algorithms) plugins at container start. | [Docker plugins](https://neo4j.com/docs/operations-manual/current/docker/operations/#docker-neo4j-plugins) · [APOC](https://neo4j.com/labs/apoc/) · [GDS](https://neo4j.com/docs/graph-data-science/current/installation/) |
| `NEO4J_dbms_security_procedures_unrestricted=apoc.*,gds.*` | Neo4j sandboxes procedures by default; this env var maps to the dotted config key `dbms.security.procedures.unrestricted`, allowlisting APOC/GDS procedures to run without the sandbox. | [Config settings reference](https://neo4j.com/docs/operations-manual/current/configuration/configuration-settings/#config_dbms.security.procedures.unrestricted) |
| `NEO4J_server_memory_heap_initial__size` / `..._max__size` | JVM heap sizing (double underscore `__` encodes a literal underscore in the original key `heap.initial_size`). Bumped to 1G/2G to give GDS's in-memory graph projections room. | [Memory configuration](https://neo4j.com/docs/operations-manual/current/performance/memory-configuration/) |
| `volumes` (`data`, `logs`, `import`, `plugins`) | Persist the graph database, logs, the directory `LOAD CSV` reads from, and downloaded plugin jars (so plugins aren't re-fetched every restart). | [Docker volumes](https://neo4j.com/docs/operations-manual/current/docker/volumes/) |
| `ports: 7474, 7687` | `7474` = HTTP (Neo4j Browser + REST/query API); `7687` = Bolt (the binary protocol drivers/LangChain use). | [Neo4j Docker docs](https://neo4j.com/docs/operations-manual/current/docker/introduction/) |
| `healthcheck` | Spider-checks the HTTP port responds — doesn't verify Bolt or auth, just that the server process is up. | [Compose `healthcheck`](https://docs.docker.com/reference/compose-file/services/#healthcheck) |

#### Top-level: `volumes`, `networks`, `restart`

| Key | Purpose | Docs |
| - | - | - |
| `volumes:` (named, no driver options) | Docker manages these on the host; they outlive `docker compose down` (but not `down -v`). | [Compose top-level `volumes`](https://docs.docker.com/reference/compose-file/volumes/) |
| `networks: legal-agent-net (driver: bridge)` | An isolated Docker bridge network so the four services can reach each other by service name (`opensearch`, `chromadb`, `neo4j`) without exposing that DNS to the host or other Compose projects. | [Compose networking](https://docs.docker.com/compose/how-tos/networking/) |
| `restart: unless-stopped` | Auto-restarts a crashed container on Docker daemon restart, but respects a manual `docker compose stop`. | [Compose `restart`](https://docs.docker.com/reference/compose-file/services/#restart) |

### Changing the OpenSearch admin password after the first start

`OPENSEARCH_ADMIN_PASSWORD` in `.env` only takes effect **once** — the very first time the container starts, when the internal security index (`.opendistro_security`) doesn't exist yet. On every start after that, OpenSearch sees the index already exists in the `opensearch-data` volume and skips re-applying it. This holds even across a full `docker compose down` / `up`, since `down` (without `-v`) doesn't touch volumes.

Two failure modes to know about if you edit `.env` and just recreate the container:

- **Weak new password** (fails OpenSearch's strength policy — min 8 chars, upper+lower+digit+special): the demo security installer re-validates the password on *every* start, not just the first, and quits if it fails. The container will crash-loop (`Restarting (1)`), even though nothing about the actual cluster changed.
- **Valid new password**: the container starts fine, but the password silently has no effect — the cluster keeps authenticating with the original first-boot password. The visible symptom is the `healthcheck` failing (`401`), since it uses `${OPENSEARCH_ADMIN_PASSWORD}` from the current `.env`, which no longer matches. Anything with `depends_on: condition: service_healthy` on `opensearch` (i.e. `opensearch-dashboards`) will then never start.

**You do not need to delete the `opensearch-data` volume to change the password.** The proper fix is `securityadmin.sh`, a tool bundled inside the OpenSearch image (not a host tool — it ships with the image at `/usr/share/opensearch/plugins/opensearch-security/tools/`, along with `hash.sh` and the demo TLS certs it needs). The normal Security REST API (`PUT _plugins/_security/api/internalusers/admin`) won't work here — the demo config marks `admin` as a **reserved** user, and the API refuses to modify reserved users (`403 FORBIDDEN: Resource 'admin' is reserved`).

Steps (run against the already-running `legal-agent-opensearch` container, no volume deletion, no downtime):

1. Generate a bcrypt hash for the new password:

   ```sh
   docker exec legal-agent-opensearch /usr/share/opensearch/plugins/opensearch-security/tools/hash.sh -p '<new-password>'
   ```

2. Edit the `admin` user's `hash` field in the container's `internal_users.yml` to the value from step 1:

   ```sh
   docker exec legal-agent-opensearch sed -i 's#<old-hash>#<new-hash>#' /usr/share/opensearch/config/opensearch-security/internal_users.yml
   ```

3. Push just that change to the live security index:

   ```sh
   docker exec legal-agent-opensearch /usr/share/opensearch/plugins/opensearch-security/tools/securityadmin.sh \
     -cd /usr/share/opensearch/config/opensearch-security/ \
     -icl -nhnv \
     -cacert /usr/share/opensearch/config/root-ca.pem \
     -cert /usr/share/opensearch/config/kirk.pem \
     -key /usr/share/opensearch/config/kirk-key.pem \
     -f /usr/share/opensearch/config/opensearch-security/internal_users.yml \
     -t internalusers
   ```

4. Update `OPENSEARCH_ADMIN_PASSWORD` in `.env` to match, so the `healthcheck` and Dashboards agree with the cluster again.

**Why this doesn't need the data volume touched, but does need a container exec:** `internal_users.yml` itself is *not* persisted — it lives in the container's writable layer (only `/usr/share/opensearch/data` is a named volume) and gets regenerated fresh from `OPENSEARCH_INITIAL_ADMIN_PASSWORD` on every new container. Editing it is just a one-time vehicle to feed `securityadmin.sh`. What actually persists is the `.opendistro_security` **index** that `securityadmin.sh` writes to, which lives under `/usr/share/opensearch/data` — the real, durable source of truth for credentials, and the reason none of this requires wiping the volume. On Windows/Git Bash, prefix these commands with `MSYS_NO_PATHCONV=1` so `/usr/share/...` paths aren't mistranslated into Windows paths.

References: [`securityadmin.sh` docs](https://opensearch.org/docs/latest/security/configuration/security-admin/) · [Generating password hashes](https://opensearch.org/docs/latest/security/configuration/yaml/#internal_usersyml) · [Access control API (internal users)](https://opensearch.org/docs/latest/security/access-control/api/#users)

### Changing the Neo4j password after the first start

Same underlying issue as OpenSearch: `NEO4J_AUTH` in `.env` only sets the password on the database's true first startup. Neo4j's own log says so explicitly on every subsequent start:

```text
Changed password for user 'neo4j'. IMPORTANT: this change will only take effect if performed
before the database is started for the first time.
```

So editing `.env` and recreating the container (even a full `down`/`up`, since `down` alone doesn't touch the `neo4j-data` volume) does nothing — the old password from first boot keeps working, and the new one from `.env` gets `The client is unauthorized due to authentication failure`. Note also: Neo4j locks out an account for a bit after repeated failed logins (`The client has provided incorrect authentication details too many times in a row`) — if you hit that while testing, just wait ~30s and retry.

Unlike OpenSearch, no `securityadmin.sh`-style workaround is needed — Neo4j has a built-in admin Cypher command for exactly this, and `neo4j` isn't a reserved user the way OpenSearch's `admin` is:

```sh
docker exec legal-agent-neo4j cypher-shell -u neo4j -p '<current-password>' \
  "ALTER USER neo4j SET PASSWORD '<new-password>' CHANGE NOT REQUIRED;"
```

`CHANGE NOT REQUIRED` skips forcing a password change on next login (Neo4j's default for an admin-altered account). This writes straight into the persisted auth store under `/data` (the `neo4j-data` volume), so it survives container recreation — no volume deletion needed. Then update `NEO4J_PASSWORD` in `.env` to match.

Reference: [Cypher `ALTER USER` syntax](https://neo4j.com/docs/cypher-manual/current/access-control/manage-users/#access-control-manage-users-alter)

### Notes

- All data is persisted in named Docker volumes (`postgres-data`, `opensearch-data`, `chromadb-data`, `neo4j-data`, etc.), so `docker compose down` alone is safe. Use `docker compose down -v` only if you intend to wipe all indexed/stored data.
- Postgres is provisioned as the source of truth, but there is no CDC pipeline yet — nothing currently propagates a Postgres write to OpenSearch, ChromaDB, or Neo4j. See [CDC pipeline (proposed)](#cdc-pipeline-proposed) for the planned sync design (Debezium Server, per-document `content_version`, a `document_sync_state` table, and a reconciliation job) and [DATABASE_DESIGN.md](DATABASE_DESIGN.md) for the schema it syncs.
- Neo4j ships with the APOC and Graph Data Science (GDS) plugins enabled — APOC for general graph procedures (used by GraphRAG-style construction), GDS for graph algorithms (community detection, centrality, similarity) if the agent needs them later.
- This setup runs without TLS/auth hardening on ChromaDB and is intended for local development. Add `CHROMA_SERVER_AUTHN_*` env vars before exposing it beyond localhost.
- On Windows, OpenSearch runs fine under Docker Desktop's default WSL2 backend. If it fails to start with a `vm.max_map_count` error, run `wsl -d docker-desktop sysctl -w vm.max_map_count=262144`.

### Stopping

```sh
docker compose down
```
