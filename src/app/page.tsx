// "/" redirects to the user's fund, preferring the one remembered in the
// smif_fund cookie (spec Section 7, "Fund resolution"). With nothing
// remembered, it picks the fund where they have the most to do, so an Athena
// analyst who is only a viewer on Arch lands on Athena.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAccessibleFunds, getAuthState, pickLandingFund } from "@/lib/fund";

export default async function Home() {
  const { user } = await getAuthState();
  if (!user) redirect("/login");

  const funds = await getAccessibleFunds();
  if (funds.length === 0) redirect("/no-access");

  const cookieStore = await cookies();
  const remembered = cookieStore.get("smif_fund")?.value;
  const target =
    funds.find((f) => f.slug === remembered) ??
    (await pickLandingFund(funds)) ??
    funds[0];
  redirect(`/${target.slug}`);
}
