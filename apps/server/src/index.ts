import { createTrackingServer } from "./tracking-server";

const port = Number(process.env.PORT ?? 3710);
const { http } = createTrackingServer({ crewCode: process.env.CREW_CODE, dispatchToken: process.env.DISPATCH_TOKEN });

http.listen(port, () => {
  console.log(`Crewline tracking server on port ${port}`);
  if (!process.env.CREW_CODE || !process.env.DISPATCH_TOKEN) {
    console.log("CREW_CODE or DISPATCH_TOKEN isn't set, so anyone who can reach this port can join. Fine for local testing only.");
  }
});
