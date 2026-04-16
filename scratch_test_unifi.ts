import { listActiveGuests } from "./src/lib/unifi";

async function run() {
  require("dotenv").config();
  try {
    const guests = await listActiveGuests();
    console.log(JSON.stringify(guests, null, 2));
  } catch(e) {
    console.error(e);
  }
}
run();
