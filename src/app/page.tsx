// "/" redirects to the user's fund, preferring the one remembered in the
// smif_fund cookie (spec Section 7, "Fund resolution").

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAccessibleFunds, getAuthState } from "@/lib/fund";

export default async function Home() {
  const { user } = await getAuthState();
  if (!user) redirect("/login");

  const funds = await getAccessibleFunds();
  if (funds.length === 0) redirect("/no-access");

  const cookieStore = await cookies();
  const remembered = cookieStore.get("smif_fund")?.value;
  const target =
    funds.find((f) => f.slug === remembered)?.slug ?? funds[0].slug;
  redirect(`/${target}`);
}
