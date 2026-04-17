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
    const [identity, resource, interfaces, addresses, bridges, pppSecrets] = await Promise.all([
      client.system.identity.get(),
      client.system.resource.get({
        proplist: ["uptime", "version", "cpu-load"],
      }),
      client.interface.list({
        proplist: [".id", "name", "running", "disabled"],
      }),
      client.ip.address.list({
        proplist: [".id", "address", "interface", "disabled"],
      }),
      client.bridge.list({
        proplist: [".id", "name", "vlan-filtering", "disabled"],
      }),
      client.ppp.secret.list({
        proplist: [".id", "name", "service", "profile", "disabled"],
      }),
    ]);

    console.log({
      identity,
      resource,
      interfaces,
      addresses,
      bridges,
      pppSecrets,
    });
  } finally {
    await client.close();
  }
}

void main();
