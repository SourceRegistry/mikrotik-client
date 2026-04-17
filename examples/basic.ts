import { RouterOSClient } from "../src/index";

async function main() {
  const client = new RouterOSClient({
    host: process.env.MIKROTIK_HOST ?? "192.168.88.1",
    username: process.env.MIKROTIK_USERNAME ?? "admin",
    password: process.env.MIKROTIK_PASSWORD ?? "",
    tls: process.env.MIKROTIK_TLS === "true",
    port: process.env.MIKROTIK_PORT ? Number(process.env.MIKROTIK_PORT) : undefined,
  });

  try {
    const records = await client.execute("/system/resource/print", {
      attributes: {
        ".proplist": ["uptime", "version", "cpu-load"],
      },
    });

    console.log(records.records[0]);
  } finally {
    await client.close();
  }
}

void main();
