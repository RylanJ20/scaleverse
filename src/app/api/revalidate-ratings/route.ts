import { revalidateTag } from "next/cache";

// Called by the fit-ratings edge function after each non-skipped refit
// (secured by the same FIT_SECRET the fit itself requires). Marks every
// ratings-derived cache entry stale — next visit serves stale + refreshes in
// the background (SWR), so rankings track the fit without per-request DB reads.
export async function POST(req: Request) {
  const secret = process.env.FIT_SECRET;
  if (!secret || req.headers.get("x-fit-secret") !== secret) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  revalidateTag("ratings", "max");
  return Response.json({ revalidated: true });
}
