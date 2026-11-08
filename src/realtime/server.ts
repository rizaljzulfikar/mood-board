import { startHub } from "./hub";

const port = Number(process.env.REALTIME_PORT ?? 4000);
const secret = process.env.REALTIME_SECRET;
if (!secret) {
  console.error("[realtime] REALTIME_SECRET is required");
  process.exit(1);
}
void startHub({ port, secret }).then(() => {
  console.log(`[realtime] listening on :${port}`);
});
