export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <h1 className="text-4xl font-black uppercase italic">@{username}</h1>
      <p className="text-muted">
        Take records and voting stats are coming soon.
      </p>
    </main>
  );
}
