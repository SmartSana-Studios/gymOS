// comment mentioning getClaims() only
const { data } = await supabase.auth.getClaims();
if (data.claims.app_role !== "owner") throw new Error();
