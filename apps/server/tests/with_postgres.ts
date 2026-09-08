// Run against a disposable PostgreSQL cluster; never touches an existing database.
const directory = await Deno.makeTempDir({ prefix: "pmai-postgres-" });
const bin = Deno.env.get("PMAI_TEST_PG_BIN");
const executable = (name: string) => bin ? `${bin}/${name}` : name;
const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
const port = listener.addr.port;
listener.close();
async function run(
  command: string,
  args: string[],
  env?: Record<string, string>,
) {
  const child = new Deno.Command(command, {
    args,
    env,
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const status = await child.status;
  if (!status.success) throw new Error(`${command} exited ${status.code}`);
}
let started = false;
try {
  await run(executable("initdb"), [
    "-D",
    `${directory}/data`,
    "-A",
    "trust",
    "-U",
    "pmai_test",
    "--no-locale",
    "--encoding=UTF8",
  ]);
  await run(executable("pg_ctl"), [
    "-D",
    `${directory}/data`,
    "-l",
    `${directory}/postgres.log`,
    "-o",
    `-h 127.0.0.1 -p ${port} -k ${directory}`,
    "-w",
    "start",
  ]);
  started = true;
  await run(Deno.execPath(), [
    "test",
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "--allow-net",
    "--allow-run",
    ...Deno.args,
  ], {
    PMAI_TEST_DATABASE_URL: `postgres://pmai_test@127.0.0.1:${port}/postgres`,
  });
} finally {
  if (started) {
    await run(executable("pg_ctl"), [
      "-D",
      `${directory}/data`,
      "-m",
      "fast",
      "-w",
      "stop",
    ]);
  }
  await Deno.remove(directory, { recursive: true });
}
