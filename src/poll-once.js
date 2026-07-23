import "dotenv/config";
import { runPollOnce } from "./poller.js";

runPollOnce()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
