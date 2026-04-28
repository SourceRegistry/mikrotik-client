import { RouterOSClient } from "../src/index";

async function main() {
  const client = new RouterOSClient({
    host: process.env.MIKROTIK_HOST ?? "192.168.88.1",
    username: process.env.MIKROTIK_USERNAME ?? "admin",
    password: process.env.MIKROTIK_PASSWORD ?? "",
    tls: process.env.MIKROTIK_TLS === "true",
    ...(process.env.MIKROTIK_PORT ? { port: Number(process.env.MIKROTIK_PORT) } : {}),
  });

  const stream = await client.interface.listen();

  const stop = async () => {
    try {
      await stream.cancel();
    } finally {
      await client.close();
    }
  };

  process.on("SIGINT", () => {
    void stop();
  });

  try {
    for await (const reply of stream) {
      console.log(reply.type, reply.attributes);
    }
  } finally {
    await client.close();
  }
}

void main();
