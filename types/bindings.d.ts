// DB is optional: the current Sites manifest has no D1 binding. getDb()
// checks availability before using it, and Sites owns actual provisioning.
declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
  }
}
