import "reflect-metadata";
import { serve } from "@litmus/http";
import { Hono } from "hono";

const app = new Hono().get("/", (c) => c.text("ok"));

await serve(app, {
  port: 0,
  onBeforeStop: () => {
    process.stdout.write("STOPPED\n");
  },
});

process.stdout.write("READY\n");
