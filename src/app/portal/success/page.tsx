import { headers } from "next/headers";
import { getLocale, dictionaries } from "@/lib/i18n/dictionaries";
import { SuccessClient } from "./SuccessClient";

export default async function PortalSuccessPage() {
  const headersList = await headers();
  const locale = getLocale(headersList.get("accept-language"));
  const dict = dictionaries[locale];

  return <SuccessClient dict={dict} />;
}
