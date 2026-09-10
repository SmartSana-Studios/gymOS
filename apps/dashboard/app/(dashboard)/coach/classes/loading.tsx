// Story 17.3 review: without a loading.tsx of its own this route inherits
// coach/loading.tsx -- AD-14's member-list rows -- while navigating here.
// `null` matches the page's own <Suspense> fallback; Story 17.4 replaces both
// with AD-21's real skeleton when it builds this page.
export default function CoachClassesLoading() {
  return null;
}
