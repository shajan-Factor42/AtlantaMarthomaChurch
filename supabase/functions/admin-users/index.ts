// Portal access management for officers/admins.
// Actions: invite (email link), create (starting password), set_password (admin), revoke (admin).
// The caller must be signed in and have the officer or admin role in public.members.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !user) return json({ error: "Please sign in again." }, 401);

    const { data: caller } = await admin.from("members").select("role").eq("auth_user_id", user.id).maybeSingle();
    if (!caller || !["officer", "admin"].includes(caller.role)) return json({ error: "Only officers can manage portal access." }, 403);
    const isAdmin = caller.role === "admin";

    const { action, member_id, password, redirect_to } = await req.json();
    const { data: m } = await admin.from("members")
      .select("id, email, auth_user_id, first_name, last_name").eq("id", member_id).maybeSingle();
    if (!m) return json({ error: "Member not found." }, 404);
    const fullName = `${m.first_name} ${m.last_name}`;

    if (action === "invite" || action === "create") {
      if (!m.email) return json({ error: "Add an email address for this member first." }, 400);
      if (m.auth_user_id) return json({ error: `${fullName} already has portal access.` }, 400);
    }

    if (action === "invite") {
      const { error } = await admin.auth.admin.inviteUserByEmail(m.email, {
        redirectTo: redirect_to, data: { full_name: fullName },
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, message: `Invitation emailed to ${m.email}.` });
    }

    if (action === "create") {
      if (!password || String(password).length < 8) return json({ error: "Use a starting password of at least 8 characters." }, 400);
      const { error } = await admin.auth.admin.createUser({
        email: m.email, password, email_confirm: true, user_metadata: { full_name: fullName },
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, message: `${fullName} can now sign in with ${m.email} and the starting password.` });
    }

    if (action === "set_password") {
      if (!isAdmin) return json({ error: "Only an admin can reset passwords." }, 403);
      if (!m.auth_user_id) return json({ error: `${fullName} doesn't have portal access yet.` }, 400);
      if (!password || String(password).length < 8) return json({ error: "Use at least 8 characters." }, 400);
      const { error } = await admin.auth.admin.updateUserById(m.auth_user_id, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, message: `Password updated for ${fullName}.` });
    }

    if (action === "revoke") {
      if (!isAdmin) return json({ error: "Only an admin can remove portal access." }, 403);
      if (!m.auth_user_id) return json({ error: `${fullName} doesn't have portal access.` }, 400);
      if (m.auth_user_id === user.id) return json({ error: "You can't remove your own access." }, 400);
      const { error } = await admin.auth.admin.deleteUser(m.auth_user_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, message: `Portal access removed for ${fullName}. Their parish record is unchanged.` });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
