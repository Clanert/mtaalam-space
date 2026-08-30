import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
const emailFrom = Deno.env.get("MTAALAM_EMAIL_FROM") ?? "";
const allowedOrigins = new Set([
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "https://mtaalam.app",
  "https://www.mtaalam.app",
  "https://mtaalam.space",
  "https://www.mtaalam.space",
  "https://mtaalam-space.nobert360.chatgpt.site",
  "https://clanert.github.io",
]);

type Json = Record<string, unknown>;
type ContentType = "course" | "lesson" | "material" | "story";
const defaultPaymentMethods = [{ id: "lipa-main", label_en: "Lipa Namba", label_sw: "Lipa Namba", provider: "Mobile payment", account_name: "Mtaalam Space", account_number: "654321", instructions_en: "Use this number, then upload your receipt.", instructions_sw: "Tumia namba hii, kisha pakia risiti yako.", whatsapp_number: "", enabled: true, sort_order: 1 }];

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function text(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanPaymentMethods(value: unknown, includeDisabled = false) {
  if (!Array.isArray(value)) return defaultPaymentMethods;
  const methods = value.slice(0, 10).map((item: any, index: number) => ({
    id: text(item?.id, 80).replace(/[^a-zA-Z0-9_-]/g, "") || `payment-${index + 1}`,
    label_en: text(item?.label_en, 80),
    label_sw: text(item?.label_sw || item?.label_en, 80),
    provider: text(item?.provider, 80),
    account_name: text(item?.account_name, 120),
    account_number: text(item?.account_number, 60),
    instructions_en: text(item?.instructions_en, 500),
    instructions_sw: text(item?.instructions_sw || item?.instructions_en, 500),
    whatsapp_number: text(item?.whatsapp_number, 30).replace(/[^0-9+]/g, ""),
    enabled: Boolean(item?.enabled),
    sort_order: Math.max(1, Math.min(100, Number(item?.sort_order || index + 1))),
  })).filter((item) => item.label_en.length >= 2 && item.account_number.length >= 3);
  return (includeDisabled ? methods : methods.filter((item) => item.enabled)).sort((a, b) => a.sort_order - b.sort_order);
}

function uuid(value: unknown) {
  const valueText = String(value ?? "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valueText) ? valueText : "";
}

function bearer(req: Request) {
  const value = req.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function contactCredentials(contact: string, password: string) {
  const clean = contact.trim();
  if (clean.includes("@")) return { email: clean.toLowerCase(), password };
  const digits = clean.replace(/\s/g, "");
  return { phone: digits.startsWith("0") ? "+255" + digits.slice(1) : digits, password };
}

function contentConfig(resource: string) {
  const configs: Record<string, { table: string; fields: string[] }> = {
    course: { table: "mtaalam_courses", fields: ["title_en","title_sw","description_en","description_sw","category_en","category_sw","price_tzs","access_days","thumbnail_url","published","available_until","is_flagged","flag_reason"] },
    lesson: { table: "mtaalam_lessons", fields: ["course_id","title_en","title_sw","short_en","short_sw","description_en","description_sw","category_en","category_sw","duration","price_tzs","access_days","thumbnail_url","is_free","published","sort_order","available_until","is_flagged","flag_reason"] },
    material: { table: "mtaalam_materials", fields: ["title_en","title_sw","description_en","description_sw","category_en","category_sw","pages","price_tzs","access_days","thumbnail_url","published","available_until","is_flagged","flag_reason"] },
    story: { table: "mtaalam_stories", fields: ["learner_name","media_type","role_en","role_sw","quote_en","quote_sw","context_en","context_sw","image_url","published","sort_order","available_until","is_flagged","flag_reason"] },
  };
  return configs[resource] ?? null;
}

function slugify(value: string) {
  const clean = value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
  return (clean || "content") + "-" + crypto.randomUUID().slice(0, 8);
}

function safeName(name: string) {
  const clean = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean.slice(-100) || "upload";
}

function uploadTarget(resource: string, kind: string, id: string, fileName: string, mime: string, size: number) {
  const file = safeName(fileName);
  const nonce = crypto.randomUUID();
  if (kind === "image" && ["course","lesson","material","story"].includes(resource)) {
    if (!["image/jpeg","image/png","image/webp"].includes(mime) || size > 15 * 1024 * 1024) return null;
    return { bucket: "mtaalam-public", path: `images/${resource}/${id}/${nonce}-${file}`, column: resource === "story" ? "image_url" : "thumbnail_url" };
  }
  if (kind === "video" && ["lesson","story"].includes(resource)) {
    if (!["video/mp4","video/webm"].includes(mime) || size > 500 * 1024 * 1024) return null;
    return { bucket: "mtaalam-private", path: `${resource}s/${id}/${nonce}-${file}`, column: "video_path" };
  }
  if (kind === "document" && resource === "material") {
    if (mime !== "application/pdf" || size > 50 * 1024 * 1024) return null;
    return { bucket: "mtaalam-private", path: `materials/${id}/${nonce}-${file}`, column: "file_path" };
  }
  return null;
}

function contentAvailable(row: any) {
  return Boolean(row?.published && !row?.deleted_at && !row?.is_flagged && (!row?.available_until || new Date(row.available_until).getTime() > Date.now()));
}

async function authContext(req: Request) {
  const token = bearer(req);
  if (!token) return { user: null, error: "Please log in first." };
  const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: "Bearer " + token } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { user: null, error: error?.message ?? "Session expired." };
  const admin = adminClient();
  const { data: profile } = await admin.from("mtaalam_profiles").select("is_suspended").eq("user_id", data.user.id).maybeSingle();
  if (profile?.is_suspended) return { user: null, error: "This account is suspended. Contact support." };
  return { user: data.user, error: null };
}

async function securityEvent(input: Json) {
  const admin = adminClient();
  await admin.from("mtaalam_security_events").insert({
    user_id: input.user_id || null,
    event_type: text(input.event_type, 80),
    severity: ["low","medium","high","critical"].includes(String(input.severity)) ? input.severity : "medium",
    item_type: input.item_type || null,
    item_id: input.item_id || null,
    purchase_id: input.purchase_id || null,
    summary: text(input.summary, 300),
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  });
}

async function activity(input: Json) {
  const admin = adminClient();
  await admin.from("mtaalam_content_activity").insert({
    user_id: input.user_id,
    item_type: input.item_type,
    item_id: input.item_id,
    event_type: input.event_type,
    purchase_id: input.purchase_id || null,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  });
}

async function activeGrant(userId: string, itemType: string, itemId: string) {
  const admin = adminClient();
  const { data } = await admin.from("mtaalam_access_grants").select("id,item_type,item_id,starts_at,expires_at,purchase_id")
    .eq("user_id", userId).eq("item_type", itemType).eq("item_id", itemId).is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).maybeSingle();
  return data ?? null;
}

async function proofSignature(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (file.type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.type === "image/png") return bytes.slice(0, 8).every((v, i) => v === [137,80,78,71,13,10,26,10][i]);
  if (file.type === "image/webp") return new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  return false;
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}

async function sendAnnouncement(admin: ReturnType<typeof adminClient>, announcement: any) {
  const { data: recipients, error } = await admin.from("mtaalam_announcement_recipients").select("id,email").eq("announcement_id", announcement.id).eq("status", "pending").limit(500);
  if (error) throw error;
  if (!resendKey || !emailFrom) return { configured: false, sent: 0, pending: recipients?.length ?? 0 };
  let sent = 0;
  for (let offset = 0; offset < (recipients?.length ?? 0); offset += 100) {
    const chunk = (recipients ?? []).slice(offset, offset + 100);
    const response = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `${announcement.id}-${offset / 100}` },
      body: JSON.stringify(chunk.map((recipient) => ({ from: emailFrom, to: [recipient.email], subject: announcement.subject, html: `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2 style="color:#233b91">Mtaalam Space</h2><p>${escapeHtml(announcement.message).replace(/\n/g,"<br>")}</p><p><a href="https://clanert.github.io/mtaalam-space/" style="background:#8cc641;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px">Open Mtaalam Space</a></p></div>` }))),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      await admin.from("mtaalam_announcement_recipients").update({ status: "failed", error_message: text((result as any).message || "Email provider error", 500) }).in("id", chunk.map((r) => r.id));
      continue;
    }
    const ids = Array.isArray((result as any).data) ? (result as any).data : [];
    for (let i = 0; i < chunk.length; i++) {
      await admin.from("mtaalam_announcement_recipients").update({ status: "sent", provider_id: ids[i]?.id ?? null, sent_at: new Date().toISOString() }).eq("id", chunk[i].id);
      sent++;
    }
  }
  await admin.from("mtaalam_announcements").update({ status: sent ? "sent" : "failed", sent_at: sent ? new Date().toISOString() : null }).eq("id", announcement.id);
  return { configured: true, sent, pending: Math.max(0, (recipients?.length ?? 0) - sent) };
}

async function sendDirectEmail(to: string | null | undefined, subject: string, message: string) {
  if (!to || !resendKey || !emailFrom) return { configured: false, sent: false };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: emailFrom, to: [to], subject, html: `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2 style="color:#233b91">Mtaalam Space</h2><p>${escapeHtml(message).replace(/\n/g,"<br>")}</p><p><a href="https://clanert.github.io/mtaalam-space/" style="background:#8cc641;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px">Open Mtaalam Space</a></p></div>` }),
    });
    return { configured: true, sent: response.ok };
  } catch {
    return { configured: true, sent: false };
  }
}

async function notifyAdministrators(admin: ReturnType<typeof adminClient>, subject: string, message: string) {
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const recipients = (users.data?.users ?? []).filter((u) => u.app_metadata?.role === "admin" && u.email);
  return Promise.all(recipients.map((u) => sendDirectEmail(u.email, subject, message)));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const origin = req.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return json(req, { error: "Origin not allowed." }, 403);
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "catalog";
  const admin = adminClient();

  try {
    if (req.method === "GET" && action === "catalog") {
      const now = new Date().toISOString();
      const [courses, lessons, materials, stories, settings, paymentSettings] = await Promise.all([
        admin.from("mtaalam_courses").select("id,slug,title_en,title_sw,description_en,description_sw,category_en,category_sw,price_tzs,access_days,thumbnail_url,published,available_until").eq("published", true).is("deleted_at", null).eq("is_flagged", false).or(`available_until.is.null,available_until.gt.${now}`).order("created_at"),
        admin.from("mtaalam_lessons").select("id,course_id,slug,sort_order,title_en,title_sw,short_en,short_sw,description_en,description_sw,category_en,category_sw,duration,price_tzs,access_days,thumbnail_url,is_free,published,available_until").eq("published", true).is("deleted_at", null).eq("is_flagged", false).or(`available_until.is.null,available_until.gt.${now}`).order("sort_order"),
        admin.from("mtaalam_materials").select("id,slug,title_en,title_sw,description_en,description_sw,category_en,category_sw,pages,price_tzs,access_days,thumbnail_url,published,available_until").eq("published", true).is("deleted_at", null).eq("is_flagged", false).or(`available_until.is.null,available_until.gt.${now}`).order("created_at"),
        admin.from("mtaalam_stories").select("id,sort_order,media_type,image_url,learner_name,role_en,role_sw,quote_en,quote_sw,context_en,context_sw,published,available_until").eq("published", true).is("deleted_at", null).eq("is_flagged", false).or(`available_until.is.null,available_until.gt.${now}`).order("sort_order"),
        admin.from("mtaalam_site_settings").select("setting_value").eq("setting_key", "home").maybeSingle(),
        admin.from("mtaalam_site_settings").select("setting_value").eq("setting_key", "payments").maybeSingle(),
      ]);
      const error = courses.error || lessons.error || materials.error || stories.error || settings.error || paymentSettings.error;
      if (error) return json(req, { error: error.message }, 500);
      const paymentValue: any = paymentSettings.data?.setting_value ?? {};
      return json(req, { courses: courses.data, lessons: lessons.data, materials: materials.data, stories: stories.data, home: settings.data?.setting_value ?? {}, payment_methods: cleanPaymentMethods(paymentValue.methods) });
    }

    if (req.method === "GET" && action === "reviews") {
      const lessonId = uuid(url.searchParams.get("lesson_id"));
      if (!lessonId) return json(req, { error: "Invalid lesson." }, 400);
      let viewerId = "";
      const token = bearer(req);
      if (token) {
        const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const { data: viewer } = await client.auth.getUser(token);
        viewerId = viewer.user?.id ?? "";
      }
      const [reviews, likes, viewerLike] = await Promise.all([
        admin.from("mtaalam_reviews").select("id,rating,review_text,created_at").eq("lesson_id", lessonId).eq("is_visible", true).order("created_at", { ascending: false }).limit(100),
        admin.from("mtaalam_likes").select("id", { count: "exact", head: true }).eq("lesson_id", lessonId),
        viewerId ? admin.from("mtaalam_likes").select("id").eq("lesson_id", lessonId).eq("user_id", viewerId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ]);
      const error = reviews.error || likes.error || viewerLike.error;
      if (error) return json(req, { error: error.message }, 400);
      return json(req, { reviews: reviews.data, like_count: likes.count ?? 0, liked: Boolean(viewerLike.data) });
    }

    if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);

    if (action === "signup" || action === "login") {
      const body = await req.json();
      const contact = text(body.contact, 254);
      const password = String(body.password ?? "");
      if (!contact || password.length < 8 || password.length > 128) return json(req, { error: "Use a valid contact and a password of at least 8 characters." }, 400);
      const publicClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const credentials = contactCredentials(contact, password);
      const result = action === "signup"
        ? await publicClient.auth.signUp({ ...credentials, options: { data: { full_name: text(body.name, 100) } } })
        : await publicClient.auth.signInWithPassword(credentials);
      if (result.error) return json(req, { error: result.error.message }, 400);
      if (result.data.user) {
        const { data: profile } = await admin.from("mtaalam_profiles").select("is_suspended").eq("user_id", result.data.user.id).maybeSingle();
        if (profile?.is_suspended) return json(req, { error: "This account is suspended. Contact support." }, 403);
        await admin.from("mtaalam_profiles").upsert({ user_id: result.data.user.id, full_name: text(body.name || result.data.user.user_metadata?.full_name, 100), phone: result.data.user.phone || null }, { onConflict: "user_id", ignoreDuplicates: true });
        if (action === "signup") {
          const learnerName = text(body.name || result.data.user.user_metadata?.full_name || "New learner", 100);
          await securityEvent({ user_id: result.data.user.id, event_type: "new_user_registered", severity: "low", summary: `${learnerName} registered a new learner account.` });
          await notifyAdministrators(admin, "New learner registered", `${learnerName} has registered on Mtaalam Space. Open the Admin panel to view the account.`);
        }
      }
      return json(req, {
        user: result.data.user ? { id: result.data.user.id, email: result.data.user.email, phone: result.data.user.phone, name: result.data.user.user_metadata?.full_name ?? "" } : null,
        session: result.data.session ? { access_token: result.data.session.access_token, refresh_token: result.data.session.refresh_token, expires_at: result.data.session.expires_at } : null,
        confirmation_required: action === "signup" && !result.data.session,
      });
    }

    if (action === "refresh") {
      const body = await req.json();
      const publicClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await publicClient.auth.refreshSession({ refresh_token: text(body.refresh_token, 4096) });
      if (error || !data.session) return json(req, { error: error?.message ?? "Session expired." }, 401);
      return json(req, { session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_at: data.session.expires_at }, user: data.user });
    }

    const auth = await authContext(req);
    if (!auth.user || auth.error) return json(req, { error: auth.error ?? "Unauthorized." }, 401);
    const user = auth.user;
    const isAdmin = user.app_metadata?.role === "admin";

    if (action === "me" || action === "profile") {
      const { data: profile } = await admin.from("mtaalam_profiles").select("full_name,phone,preferred_language,is_suspended").eq("user_id", user.id).maybeSingle();
      return json(req, { user: { id: user.id, email: user.email, phone: profile?.phone || user.phone, name: profile?.full_name || user.user_metadata?.full_name || "", preferred_language: profile?.preferred_language || "en", is_admin: isAdmin, is_suspended: Boolean(profile?.is_suspended) } });
    }

    if (action === "profile-update") {
      const body = await req.json();
      const language = body.preferred_language === "sw" ? "sw" : "en";
      const values = { user_id: user.id, full_name: text(body.full_name, 100), phone: text(body.phone, 30) || null, preferred_language: language, updated_at: new Date().toISOString() };
      const { data, error } = await admin.from("mtaalam_profiles").upsert(values, { onConflict: "user_id" }).select("full_name,phone,preferred_language").single();
      if (error) return json(req, { error: error.message }, 400);
      await admin.auth.admin.updateUserById(user.id, { user_metadata: { ...user.user_metadata, full_name: values.full_name } });
      return json(req, { profile: data });
    }

    if (action === "access") {
      const [grants, requests] = await Promise.all([
        admin.from("mtaalam_access_grants").select("item_type,item_id,starts_at,expires_at,purchase_id").eq("user_id", user.id).is("revoked_at", null).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`),
        admin.from("mtaalam_purchases").select("id,request_code,item_type,item_id,amount_tzs,status,created_at,proof_uploaded_at,rejection_reason").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
      ]);
      const error = grants.error || requests.error;
      if (error) return json(req, { error: error.message }, 400);
      return json(req, { grants: grants.data, purchases: (grants.data ?? []).map((g) => ({ item_type: g.item_type, item_id: g.item_id, status: "approved", expires_at: g.expires_at })), requests: requests.data });
    }

    if (action === "review") {
      const body = await req.json();
      const lessonId = uuid(body.lesson_id);
      const rating = Number(body.rating);
      const reviewText = text(body.review_text, 500);
      if (!lessonId || rating < 1 || rating > 5 || reviewText.length < 2) return json(req, { error: "Invalid review." }, 400);
      const { data: lesson } = await admin.from("mtaalam_lessons").select("id,course_id,is_free,published,deleted_at,is_flagged,available_until").eq("id", lessonId).maybeSingle();
      if (!contentAvailable(lesson)) return json(req, { error: "This lesson is unavailable." }, 404);
      let canReview = Boolean(lesson.is_free) || Boolean(await activeGrant(user.id, "lesson", lessonId));
      if (!canReview) canReview = Boolean(await activeGrant(user.id, "course", lesson.course_id));
      if (!canReview) return json(req, { error: "Open this lesson after payment approval before reviewing it." }, 403);
      const { data, error } = await admin.from("mtaalam_reviews").upsert({ lesson_id: lessonId, user_id: user.id, rating, review_text: reviewText }, { onConflict: "lesson_id,user_id" }).select("id,rating,review_text,created_at").single();
      if (error) return json(req, { error: error.message }, 400);
      return json(req, { review: data });
    }

    if (action === "like") {
      const body = await req.json();
      const lessonId = uuid(body.lesson_id);
      if (!lessonId) return json(req, { error: "Invalid lesson." }, 400);
      const { data: lesson } = await admin.from("mtaalam_lessons").select("id,published,deleted_at,is_flagged,available_until").eq("id", lessonId).maybeSingle();
      if (!contentAvailable(lesson)) return json(req, { error: "This lesson is unavailable." }, 404);
      const { data: existing } = await admin.from("mtaalam_likes").select("id").eq("lesson_id", lessonId).eq("user_id", user.id).maybeSingle();
      let liked: boolean;
      if (existing) {
        const { error } = await admin.from("mtaalam_likes").delete().eq("id", existing.id).eq("user_id", user.id);
        if (error) return json(req, { error: error.message }, 400);
        liked = false;
      } else {
        const { error } = await admin.from("mtaalam_likes").insert({ lesson_id: lessonId, user_id: user.id });
        if (error) return json(req, { error: error.message }, 400);
        liked = true;
      }
      const { count, error } = await admin.from("mtaalam_likes").select("id", { count: "exact", head: true }).eq("lesson_id", lessonId);
      if (error) return json(req, { error: error.message }, 400);
      return json(req, { liked, like_count: count ?? 0 });
    }

    if (action === "purchase") {
      const body = await req.json();
      const type = text(body.item_type, 20);
      const itemId = uuid(body.item_id);
      const config = contentConfig(type);
      if (!config || type === "story" || !itemId) return json(req, { error: "Invalid learning item." }, 400);
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await admin.from("mtaalam_content_activity").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("event_type", "request").gte("created_at", since);
      if ((count ?? 0) >= 15) {
        await securityEvent({ user_id: user.id, event_type: "purchase_rate_limit", severity: "high", item_type: type, item_id: itemId, summary: "Too many payment requests in one hour." });
        return json(req, { error: "Too many payment requests. Please try later." }, 429);
      }
      const { data: item } = await admin.from(config.table).select("id,price_tzs,published,deleted_at,is_flagged,available_until").eq("id", itemId).maybeSingle();
      if (!contentAvailable(item)) return json(req, { error: "This content is unavailable." }, 404);
      if (await activeGrant(user.id, type, itemId)) return json(req, { error: "You already have access to this content." }, 409);
      const { data: existing } = await admin.from("mtaalam_purchases").select("id,status,request_count").eq("user_id", user.id).eq("item_type", type).eq("item_id", itemId).maybeSingle();
      let purchase;
      if (existing) {
        const { data, error } = await admin.from("mtaalam_purchases").update({ amount_tzs: item.price_tzs, payment_reference: text(body.payment_reference, 100) || null, status: "pending", proof_path: null, proof_uploaded_at: null, proof_sha256: null, reviewed_at: null, reviewed_by: null, rejection_reason: null, last_requested_at: new Date().toISOString(), updated_at: new Date().toISOString(), request_count: Math.min(1000, Number(existing.request_count || 1) + 1), is_flagged: false, flag_reason: null }).eq("id", existing.id).select("id,request_code,status,amount_tzs").single();
        if (error) return json(req, { error: error.message }, 400);
        purchase = data;
      } else {
        const { data, error } = await admin.from("mtaalam_purchases").insert({ user_id: user.id, item_type: type, item_id: itemId, amount_tzs: item.price_tzs, payment_reference: text(body.payment_reference, 100) || null, status: "pending" }).select("id,request_code,status,amount_tzs").single();
        if (error) return json(req, { error: error.message }, 400);
        purchase = data;
      }
      await activity({ user_id: user.id, item_type: type, item_id: itemId, event_type: "request", purchase_id: purchase.id });
      return json(req, { purchase });
    }

    if (action === "cancel-purchase") {
      const body = await req.json();
      const purchaseId = uuid(body.purchase_id);
      const { data, error } = await admin.from("mtaalam_purchases").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", purchaseId).eq("user_id", user.id).eq("status", "pending").select("id,status").maybeSingle();
      if (error || !data) return json(req, { error: "Pending request not found." }, 404);
      return json(req, { purchase: data });
    }

    if (action === "proof") {
      const form = await req.formData();
      const purchaseId = uuid(form.get("purchase_id"));
      const file = form.get("file");
      if (!(file instanceof File) || !purchaseId) return json(req, { error: "Choose a payment proof image." }, 400);
      if (!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024 || !(await proofSignature(file))) return json(req, { error: "Proof must be a genuine JPG, PNG, or WebP under 8 MB." }, 400);
      const { data: purchase } = await admin.from("mtaalam_purchases").select("id,item_type,item_id,status,request_code").eq("id", purchaseId).eq("user_id", user.id).eq("status", "pending").maybeSingle();
      if (!purchase) return json(req, { error: "Pending payment request not found." }, 404);
      const digest = await sha256(file);
      const { data: duplicate } = await admin.from("mtaalam_purchases").select("id,user_id").eq("proof_sha256", digest).neq("id", purchaseId).limit(1).maybeSingle();
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `payment-proofs/${user.id}/${purchaseId}-${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await admin.storage.from("mtaalam-private").upload(path, file, { upsert: false, contentType: file.type, cacheControl: "60" });
      if (uploadError) return json(req, { error: uploadError.message }, 400);
      const flagged = Boolean(duplicate);
      const { error: updateError } = await admin.from("mtaalam_purchases").update({ proof_path: path, proof_uploaded_at: new Date().toISOString(), proof_sha256: digest, is_flagged: flagged, flag_reason: flagged ? "Duplicate payment proof detected" : null, updated_at: new Date().toISOString() }).eq("id", purchaseId).eq("user_id", user.id);
      if (updateError) return json(req, { error: updateError.message }, 500);
      if (flagged) await securityEvent({ user_id: user.id, event_type: "duplicate_payment_proof", severity: "critical", item_type: purchase.item_type, item_id: purchase.item_id, purchase_id: purchaseId, summary: "A payment proof matches a proof used on another request.", metadata: { duplicate_purchase_id: duplicate?.id } });
      await activity({ user_id: user.id, item_type: purchase.item_type, item_id: purchase.item_id, event_type: "proof_upload", purchase_id: purchaseId });
      return json(req, { uploaded: true, request_code: purchase.request_code, flagged });
    }

    if (action === "media") {
      const body = await req.json();
      const type = text(body.item_type, 20);
      const itemId = uuid(body.item_id);
      if (!itemId || !["lesson","material"].includes(type)) return json(req, { error: "Invalid media type." }, 400);
      const config = contentConfig(type)!;
      const column = type === "lesson" ? "video_path" : "file_path";
      const select = type === "lesson" ? `id,course_id,is_free,${column},published,deleted_at,is_flagged,available_until` : `id,${column},published,deleted_at,is_flagged,available_until`;
      const { data: item } = await admin.from(config.table).select(select).eq("id", itemId).maybeSingle();
      if (!contentAvailable(item) || !item?.[column]) return json(req, { error: "Media is unavailable." }, 404);
      let grant = type === "lesson" && item.is_free ? { id: "free" } : await activeGrant(user.id, type, itemId);
      if (!grant && type === "lesson") grant = await activeGrant(user.id, "course", item.course_id);
      if (!grant) {
        await activity({ user_id: user.id, item_type: type, item_id: itemId, event_type: "access_denied" });
        const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        const { count } = await admin.from("mtaalam_content_activity").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("event_type", "access_denied").gte("created_at", since);
        if ((count ?? 0) >= 5) await securityEvent({ user_id: user.id, event_type: "repeated_paid_media_denial", severity: "high", item_type: type, item_id: itemId, summary: "Repeated attempts to access paid media without an active grant." });
        return json(req, { error: "Payment approval is required." }, 403);
      }
      const { data, error } = await admin.storage.from("mtaalam-private").createSignedUrl(item[column], 120);
      if (error) return json(req, { error: "Unable to open media." }, 500);
      await activity({ user_id: user.id, item_type: type, item_id: itemId, event_type: type === "lesson" ? "play" : "download", metadata: { grant_id: grant.id } });
      return json(req, { url: data.signedUrl, expires_in: 120 });
    }

    if (!action.startsWith("admin-")) return json(req, { error: "Unknown action." }, 404);
    if (!isAdmin) {
      await securityEvent({ user_id: user.id, event_type: "admin_endpoint_denied", severity: "critical", summary: `Non-admin attempted ${action}.` });
      return json(req, { error: "Administrator access required." }, 403);
    }

    if (action === "admin-dashboard") {
      const [usersResult, profiles, courses, lessons, materials, stories, purchases, grants, events, activities, announcements, home, paymentSettings] = await Promise.all([
        admin.auth.admin.listUsers({ page: 1, perPage: 500 }),
        admin.from("mtaalam_profiles").select("user_id,full_name,phone,preferred_language,is_suspended,admin_notes"),
        admin.from("mtaalam_courses").select("*").order("created_at"),
        admin.from("mtaalam_lessons").select("*").order("sort_order"),
        admin.from("mtaalam_materials").select("*").order("created_at"),
        admin.from("mtaalam_stories").select("*").order("sort_order"),
        admin.from("mtaalam_purchases").select("*").order("created_at", { ascending: false }).limit(250),
        admin.from("mtaalam_access_grants").select("*").order("created_at", { ascending: false }).limit(250),
        admin.from("mtaalam_security_events").select("*").order("created_at", { ascending: false }).limit(150),
        admin.from("mtaalam_content_activity").select("user_id,item_type,item_id,event_type,created_at").order("created_at", { ascending: false }).limit(300),
        admin.from("mtaalam_announcements").select("*").order("created_at", { ascending: false }).limit(50),
        admin.from("mtaalam_site_settings").select("setting_value").eq("setting_key", "home").maybeSingle(),
        admin.from("mtaalam_site_settings").select("setting_value").eq("setting_key", "payments").maybeSingle(),
      ]);
      const error = usersResult.error || profiles.error || courses.error || lessons.error || materials.error || stories.error || purchases.error || grants.error || events.error || activities.error || announcements.error || home.error || paymentSettings.error;
      if (error) return json(req, { error: error.message }, 500);
      const profileMap = new Map((profiles.data ?? []).map((p: any) => [p.user_id, p]));
      const users = (usersResult.data.users ?? []).map((u) => ({ id: u.id, email: u.email, phone: profileMap.get(u.id)?.phone || u.phone, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, name: profileMap.get(u.id)?.full_name || u.user_metadata?.full_name || "", preferred_language: profileMap.get(u.id)?.preferred_language || "en", role: u.app_metadata?.role || "learner", is_suspended: Boolean(profileMap.get(u.id)?.is_suspended), admin_notes: profileMap.get(u.id)?.admin_notes || "" }));
      const paymentValue: any = paymentSettings.data?.setting_value ?? {};
      return json(req, { users, courses: courses.data, lessons: lessons.data, materials: materials.data, stories: stories.data, purchases: purchases.data, grants: grants.data, security_events: events.data, activities: activities.data, announcements: announcements.data, home: home.data?.setting_value ?? {}, payment_methods: cleanPaymentMethods(paymentValue.methods, true), email_configured: Boolean(resendKey && emailFrom) });
    }

    if (action === "admin-save") {
      const body = await req.json();
      const resource = text(body.resource, 20);
      const config = contentConfig(resource);
      const id = uuid(body.id);
      if (!config || !id) return json(req, { error: "Invalid content item." }, 400);
      const input = body.values && typeof body.values === "object" ? body.values : {};
      const values: Json = {};
      for (const field of config.fields) {
        if (!(field in input)) continue;
        let value: any = input[field];
        if (["price_tzs","pages","sort_order","access_days"].includes(field)) value = Number(value);
        if (["published","is_free","is_flagged"].includes(field)) value = Boolean(value);
        if (["available_until"].includes(field)) value = value ? new Date(value).toISOString() : null;
        if (typeof value === "string") value = text(value, field.includes("description") || field.includes("quote") || field.includes("context") ? 5000 : 500);
        values[field] = value === "" ? null : value;
      }
      if (!Object.keys(values).length) return json(req, { error: "No valid changes supplied." }, 400);
      if (resource !== "story") values.updated_at = new Date().toISOString();
      const { data, error } = await admin.from(config.table).update(values).eq("id", id).is("deleted_at", null).select().single();
      if (error) return json(req, { error: error.message }, 400);
      await securityEvent({ user_id: user.id, event_type: "admin_content_updated", severity: values.is_flagged ? "high" : "low", item_type: resource, item_id: id, summary: `Admin updated ${resource} content.` });
      return json(req, { item: data });
    }

    if (action === "admin-create-content") {
      const body = await req.json();
      const resource = text(body.resource, 20) as ContentType;
      const config = contentConfig(resource);
      if (!config) return json(req, { error: "Invalid content type." }, 400);
      const titleEn = text(body.title_en || body.learner_name, 200);
      const titleSw = text(body.title_sw || body.role_sw || titleEn, 200);
      if (titleEn.length < 2) return json(req, { error: "Add a title or learner name." }, 400);
      let values: Json;
      if (resource === "course") values = { slug: slugify(titleEn), title_en: titleEn, title_sw: titleSw, description_en: text(body.description_en, 5000), description_sw: text(body.description_sw, 5000), category_en: text(body.category_en || "Digital Skills", 100), category_sw: text(body.category_sw || "Ujuzi wa Kidijitali", 100), price_tzs: Math.max(0, Number(body.price_tzs || 0)), access_days: Math.max(0, Number(body.access_days || 0)), published: false };
      else if (resource === "lesson") values = { course_id: uuid(body.course_id), slug: slugify(titleEn), title_en: titleEn, title_sw: titleSw, short_en: text(body.short_en || titleEn, 200), short_sw: text(body.short_sw || titleSw, 200), description_en: text(body.description_en, 5000), description_sw: text(body.description_sw, 5000), category_en: text(body.category_en || "Digital Skills", 100), category_sw: text(body.category_sw || "Ujuzi wa Kidijitali", 100), duration: text(body.duration || "00:00", 30), price_tzs: Math.max(0, Number(body.price_tzs || 0)), access_days: Math.max(0, Number(body.access_days || 0)), sort_order: Math.max(1, Number(body.sort_order || 1)), is_free: false, published: false };
      else if (resource === "material") values = { slug: slugify(titleEn), title_en: titleEn, title_sw: titleSw, description_en: text(body.description_en, 5000), description_sw: text(body.description_sw, 5000), category_en: text(body.category_en || "Guides", 100), category_sw: text(body.category_sw || "Miongozo", 100), pages: Math.max(1, Number(body.pages || 1)), price_tzs: Math.max(0, Number(body.price_tzs || 0)), access_days: Math.max(0, Number(body.access_days || 0)), published: false };
      else values = { learner_name: titleEn, media_type: body.media_type === "video" ? "video" : "image", role_en: text(body.role_en || "Mtaalam learner", 200), role_sw: titleSw, quote_en: text(body.quote_en || body.description_en, 2000), quote_sw: text(body.quote_sw || body.description_sw, 2000), context_en: text(body.context_en, 5000), context_sw: text(body.context_sw, 5000), sort_order: Math.max(1, Number(body.sort_order || 1)), published: false };
      if (resource === "lesson" && !values.course_id) return json(req, { error: "Choose a course for this lesson." }, 400);
      const { data, error } = await admin.from(config.table).insert(values).select().single();
      if (error) return json(req, { error: error.message }, 400);
      await securityEvent({ user_id: user.id, event_type: "admin_content_created", severity: "low", item_type: resource, item_id: data.id, summary: `Admin created ${resource} content.` });
      await notifyAdministrators(admin, `New ${resource} created`, `${titleEn} was created as a draft in Mtaalam Space.`);
      return json(req, { item: data });
    }

    if (action === "admin-delete-content" || action === "admin-restore-content") {
      const body = await req.json();
      const resource = text(body.resource, 20);
      const config = contentConfig(resource);
      const id = uuid(body.id);
      if (!config || !id) return json(req, { error: "Invalid content item." }, 400);
      const deleting = action === "admin-delete-content";
      const values = deleting ? { deleted_at: new Date().toISOString(), published: false } : { deleted_at: null };
      const { data, error } = await admin.from(config.table).update(values).eq("id", id).select().single();
      if (error) return json(req, { error: error.message }, 400);
      if (deleting && resource !== "story") await admin.from("mtaalam_access_grants").update({ revoked_at: new Date().toISOString(), revoked_reason: "Content removed by administrator", updated_at: new Date().toISOString() }).eq("item_type", resource).eq("item_id", id).is("revoked_at", null);
      await securityEvent({ user_id: user.id, event_type: deleting ? "admin_content_deleted" : "admin_content_restored", severity: deleting ? "medium" : "low", item_type: resource, item_id: id, summary: deleting ? "Content removed from Mtaalam Space." : "Content restored in Mtaalam Space." });
      return json(req, { item: data });
    }

    if (action === "admin-update-user") {
      const body = await req.json();
      const targetId = uuid(body.user_id);
      if (!targetId) return json(req, { error: "Invalid user." }, 400);
      const self = targetId === user.id;
      if (self && (body.role || body.is_suspended !== undefined)) return json(req, { error: "You cannot change your own role or suspension status." }, 400);
      const role = body.role === "admin" ? "admin" : "learner";
      const values = { user_id: targetId, full_name: text(body.full_name, 100), phone: text(body.phone, 30) || null, preferred_language: body.preferred_language === "sw" ? "sw" : "en", is_suspended: Boolean(body.is_suspended), admin_notes: text(body.admin_notes, 1000) || null, updated_at: new Date().toISOString() };
      const { error } = await admin.from("mtaalam_profiles").upsert(values, { onConflict: "user_id" });
      if (error) return json(req, { error: error.message }, 400);
      const { data: target } = await admin.auth.admin.getUserById(targetId);
      if (!self && target.user) await admin.auth.admin.updateUserById(targetId, { app_metadata: { ...target.user.app_metadata, role }, user_metadata: { ...target.user.user_metadata, full_name: values.full_name } });
      await securityEvent({ user_id: user.id, event_type: "admin_user_updated", severity: role === "admin" || values.is_suspended ? "high" : "medium", summary: `Administrator updated account ${targetId}.`, metadata: { target_user_id: targetId, role, suspended: values.is_suspended } });
      return json(req, { updated: true });
    }

    if (action === "admin-review-payment") {
      const body = await req.json();
      const purchaseId = uuid(body.purchase_id);
      const decision = body.decision === "approved" ? "approved" : body.decision === "rejected" ? "rejected" : "";
      if (!purchaseId || !decision) return json(req, { error: "Invalid payment decision." }, 400);
      const { data: purchase } = await admin.from("mtaalam_purchases").select("*").eq("id", purchaseId).maybeSingle();
      if (!purchase || purchase.status !== "pending") return json(req, { error: "Pending payment request not found." }, 404);
      const note = text(body.note, 500);
      const manualOverride = Boolean(body.manual_override);
      if (decision === "approved" && !purchase.proof_path && (!manualOverride || note.length < 10)) return json(req, { error: "A payment proof is required. Manual override needs a clear reason." }, 400);
      if (purchase.is_flagged && decision === "approved" && (!manualOverride || note.length < 10)) return json(req, { error: "Flagged payments require a documented manual override." }, 400);
      const { data, error } = await admin.from("mtaalam_purchases").update({ status: decision, reviewed_by: user.id, reviewed_at: new Date().toISOString(), rejection_reason: decision === "rejected" ? note || "Payment could not be verified" : null, updated_at: new Date().toISOString() }).eq("id", purchaseId).eq("status", "pending").select().single();
      if (error) return json(req, { error: error.message }, 400);
      await securityEvent({ user_id: user.id, event_type: `payment_${decision}`, severity: manualOverride ? "high" : "low", item_type: purchase.item_type, item_id: purchase.item_id, purchase_id: purchaseId, summary: `Administrator ${decision} payment request ${purchase.request_code}.`, metadata: { customer_user_id: purchase.user_id, manual_override: manualOverride, note } });
      const itemConfig = contentConfig(purchase.item_type);
      const { data: paidItem } = itemConfig ? await admin.from(itemConfig.table).select("title_en").eq("id", purchase.item_id).maybeSingle() : { data: null };
      const { data: customer } = await admin.auth.admin.getUserById(purchase.user_id);
      const itemTitle = paidItem?.title_en || "your requested content";
      await sendDirectEmail(customer.user?.email, decision === "approved" ? "Your learning access is ready" : "Payment request update", decision === "approved" ? `Your payment for ${itemTitle} was approved. You can now open Mtaalam Space and view it.` : `Your payment request for ${itemTitle} was not approved. ${note || "Please contact the administrator for help."}`);
      return json(req, { purchase: data });
    }

    if (action === "admin-auto-audit") {
      const now = new Date();
      const nowIso = now.toISOString();
      const oldPendingCutoff = new Date(now.getTime() - 30 * 86400000).toISOString();
      const reviewCutoff = new Date(now.getTime() - 24 * 3600000).toISOString();
      const deniedCutoff = new Date(now.getTime() - 24 * 3600000).toISOString();
      const [expired, abandoned, pendingReview, flagged, lessonsMissing, materialsMissing, coursesList, lessonsList, denied] = await Promise.all([
        admin.from("mtaalam_access_grants").select("id").is("revoked_at", null).lt("expires_at", nowIso),
        admin.from("mtaalam_purchases").select("id").eq("status", "pending").lt("last_requested_at", oldPendingCutoff),
        admin.from("mtaalam_purchases").select("id,request_code,created_at").eq("status", "pending").lt("created_at", reviewCutoff),
        admin.from("mtaalam_purchases").select("id,request_code,flag_reason").eq("status", "pending").eq("is_flagged", true),
        admin.from("mtaalam_lessons").select("id,title_en").eq("published", true).is("deleted_at", null).is("video_path", null),
        admin.from("mtaalam_materials").select("id,title_en").eq("published", true).is("deleted_at", null).is("file_path", null),
        admin.from("mtaalam_courses").select("id,title_en").eq("published", true).is("deleted_at", null),
        admin.from("mtaalam_lessons").select("course_id").eq("published", true).is("deleted_at", null),
        admin.from("mtaalam_content_activity").select("user_id").eq("event_type", "access_denied").gte("created_at", deniedCutoff),
      ]);
      const expiredIds = (expired.data ?? []).map((row: any) => row.id);
      const abandonedIds = (abandoned.data ?? []).map((row: any) => row.id);
      if (expiredIds.length) await admin.from("mtaalam_access_grants").update({ revoked_at: nowIso, revoked_reason: "Expired automatically", updated_at: nowIso }).in("id", expiredIds);
      if (abandonedIds.length) await admin.from("mtaalam_purchases").update({ status: "cancelled", updated_at: nowIso }).in("id", abandonedIds);
      const courseIdsWithLessons = new Set((lessonsList.data ?? []).map((row: any) => row.course_id));
      const emptyCourses = (coursesList.data ?? []).filter((row: any) => !courseIdsWithLessons.has(row.id));
      const denialCounts = new Map<string, number>();
      for (const row of denied.data ?? []) denialCounts.set(row.user_id, (denialCounts.get(row.user_id) ?? 0) + 1);
      const repeatedDenials = [...denialCounts.entries()].filter(([, count]) => count >= 5).map(([user_id, count]) => ({ user_id, count }));
      const issues = [
        ...(pendingReview.data?.length ? [{ severity: "medium", label: `${pendingReview.data.length} payment request(s) waiting over 24 hours` }] : []),
        ...(flagged.data?.length ? [{ severity: "high", label: `${flagged.data.length} flagged payment proof(s) need review` }] : []),
        ...(lessonsMissing.data?.length ? [{ severity: "high", label: `${lessonsMissing.data.length} published lesson(s) have no video` }] : []),
        ...(materialsMissing.data?.length ? [{ severity: "high", label: `${materialsMissing.data.length} published material(s) have no document` }] : []),
        ...(emptyCourses.length ? [{ severity: "medium", label: `${emptyCourses.length} published course(s) have no lesson videos` }] : []),
        ...(repeatedDenials.length ? [{ severity: "high", label: `${repeatedDenials.length} user(s) repeatedly tried locked content` }] : []),
      ];
      if (issues.length) {
        const recent = new Date(now.getTime() - 6 * 3600000).toISOString();
        const { count } = await admin.from("mtaalam_security_events").select("id", { count: "exact", head: true }).eq("event_type", "admin_auto_audit").eq("status", "open").gte("created_at", recent);
        if (!count) await securityEvent({ user_id: user.id, event_type: "admin_auto_audit", severity: issues.some((issue) => issue.severity === "high") ? "high" : "medium", summary: `Automated admin check found ${issues.length} issue group(s).`, metadata: { issues } });
      }
      return json(req, { checked_at: nowIso, issues, actions: { expired_access_revoked: expiredIds.length, abandoned_requests_cancelled: abandonedIds.length }, no_token_used: true });
    }

    if (action === "admin-delete-request") {
      const body = await req.json();
      const purchaseId = uuid(body.purchase_id);
      const { data: purchase } = await admin.from("mtaalam_purchases").select("*").eq("id", purchaseId).maybeSingle();
      if (!purchase) return json(req, { error: "Request not found." }, 404);
      if (purchase.status === "approved") return json(req, { error: "Revoke access before cancelling an approved request." }, 409);
      if (purchase.proof_path) await admin.storage.from("mtaalam-private").remove([purchase.proof_path]);
      const { error } = await admin.from("mtaalam_purchases").update({ status: "cancelled", proof_path: null, proof_sha256: null, updated_at: new Date().toISOString() }).eq("id", purchaseId);
      if (error) return json(req, { error: error.message }, 400);
      await securityEvent({ user_id: user.id, event_type: "admin_request_cancelled", severity: "medium", purchase_id: purchaseId, summary: `Administrator cancelled payment request ${purchase.request_code}.` });
      return json(req, { cancelled: true });
    }

    if (action === "admin-proof-url") {
      const body = await req.json();
      const purchaseId = uuid(body.purchase_id);
      const { data: purchase } = await admin.from("mtaalam_purchases").select("proof_path").eq("id", purchaseId).maybeSingle();
      if (!purchase?.proof_path) return json(req, { error: "No proof uploaded." }, 404);
      const { data, error } = await admin.storage.from("mtaalam-private").createSignedUrl(purchase.proof_path, 120);
      if (error) return json(req, { error: error.message }, 400);
      return json(req, { url: data.signedUrl, expires_in: 120 });
    }

    if (action === "admin-revoke-access") {
      const body = await req.json();
      const grantId = uuid(body.grant_id);
      const reason = text(body.reason, 500);
      if (!grantId || reason.length < 4) return json(req, { error: "Add a reason for revoking access." }, 400);
      const { data, error } = await admin.from("mtaalam_access_grants").update({ revoked_at: new Date().toISOString(), revoked_reason: reason, updated_at: new Date().toISOString() }).eq("id", grantId).is("revoked_at", null).select().maybeSingle();
      if (error || !data) return json(req, { error: "Active access grant not found." }, 404);
      await securityEvent({ user_id: user.id, event_type: "admin_access_revoked", severity: "high", item_type: data.item_type, item_id: data.item_id, purchase_id: data.purchase_id, summary: "Administrator revoked paid content access.", metadata: { customer_user_id: data.user_id, reason } });
      return json(req, { grant: data });
    }

    if (action === "admin-security-update") {
      const body = await req.json();
      const eventId = Number(body.event_id);
      const status = body.status === "resolved" ? "resolved" : "dismissed";
      const { data, error } = await admin.from("mtaalam_security_events").update({ status, resolved_by: user.id, resolved_at: new Date().toISOString() }).eq("id", eventId).eq("status", "open").select().maybeSingle();
      if (error || !data) return json(req, { error: "Open security alert not found." }, 404);
      return json(req, { event: data });
    }

    if (action === "admin-save-home") {
      const body = await req.json();
      const allowed = ["app_name","tagline_en","tagline_sw","hero_title_en","hero_title_sw","hero_text_en","hero_text_sw","show_stories","show_testimonials"];
      const { data: existing } = await admin.from("mtaalam_site_settings").select("setting_value").eq("setting_key", "home").maybeSingle();
      const settings: Json = existing?.setting_value && typeof existing.setting_value === "object" ? { ...existing.setting_value } : {};
      for (const key of allowed) if (key in body.settings) settings[key] = typeof body.settings[key] === "boolean" ? body.settings[key] : text(body.settings[key], 1000);
      if (Array.isArray(body.settings?.hero_slides)) settings.hero_slides = body.settings.hero_slides.slice(0, 8).map((slide: any, index: number) => ({
        image_url: text(slide.image_url, 1000),
        label_en: text(slide.label_en, 100),
        label_sw: text(slide.label_sw, 100),
        title_en: text(slide.title_en, 200),
        title_sw: text(slide.title_sw, 200),
        text_en: text(slide.text_en, 1000),
        text_sw: text(slide.text_sw, 1000),
        lesson_id: uuid(slide.lesson_id) || null,
        sort_order: index + 1,
      })).filter((slide: any) => slide.image_url && slide.title_en);
      const { data, error } = await admin.from("mtaalam_site_settings").upsert({ setting_key: "home", setting_value: settings, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "setting_key" }).select("setting_value").single();
      if (error) return json(req, { error: error.message }, 400);
      return json(req, { home: data.setting_value });
    }

    if (action === "admin-save-payment-methods") {
      const body = await req.json();
      const methods = cleanPaymentMethods(body.methods, true);
      if (!methods.length) return json(req, { error: "Add at least one valid payment option." }, 400);
      if (!methods.some((method) => method.enabled)) return json(req, { error: "Keep at least one payment option active." }, 400);
      const ids = methods.map((method) => method.id);
      if (new Set(ids).size !== ids.length) return json(req, { error: "Every payment option needs a unique ID." }, 400);
      const { data, error } = await admin.from("mtaalam_site_settings").upsert({ setting_key: "payments", setting_value: { methods }, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "setting_key" }).select("setting_value").single();
      if (error) return json(req, { error: error.message }, 400);
      await securityEvent({ user_id: user.id, event_type: "admin_payment_methods_updated", severity: "medium", summary: `Administrator updated ${methods.length} payment option(s).` });
      return json(req, { payment_methods: cleanPaymentMethods((data.setting_value as any)?.methods, true) });
    }

    if (action === "admin-hero-upload-url") {
      const body = await req.json();
      const mime = text(body.mime, 100);
      const size = Number(body.size || 0);
      if (!["image/jpeg","image/png","image/webp"].includes(mime) || size <= 0 || size > 15 * 1024 * 1024) return json(req, { error: "Hero images must be JPG, PNG, or WebP under 15 MB." }, 400);
      const path = `images/hero/${crypto.randomUUID()}-${safeName(text(body.file_name, 150))}`;
      const { data, error } = await admin.storage.from("mtaalam-public").createSignedUploadUrl(path, { upsert: false });
      if (error) return json(req, { error: error.message }, 400);
      return json(req, { signed_url: data.signedUrl, path });
    }

    if (action === "admin-link-hero-upload") {
      const body = await req.json();
      const path = text(body.path, 500);
      if (!path.startsWith("images/hero/")) return json(req, { error: "Invalid hero image path." }, 400);
      const folder = path.slice(0, path.lastIndexOf("/"));
      const name = path.slice(path.lastIndexOf("/") + 1);
      const { data: objects } = await admin.storage.from("mtaalam-public").list(folder, { search: name, limit: 1 });
      if (!objects?.some((object) => object.name === name)) return json(req, { error: "Uploaded hero image was not found." }, 404);
      await notifyAdministrators(admin, "Hero image uploaded", "A new home slideshow image was uploaded in the Mtaalam Space Admin panel.");
      return json(req, { public_url: admin.storage.from("mtaalam-public").getPublicUrl(path).data.publicUrl });
    }

    if (action === "admin-announcement") {
      const body = await req.json();
      const subject = text(body.subject, 160);
      const message = text(body.message, 5000);
      const sendTo = ["all","subscribers","purchasers"].includes(body.send_to) ? body.send_to : "all";
      if (subject.length < 2 || message.length < 2) return json(req, { error: "Add an email subject and message." }, 400);
      const { data: announcement, error } = await admin.from("mtaalam_announcements").insert({ subject, message, send_to: sendTo, related_type: body.related_type || null, related_id: uuid(body.related_id) || null, status: "queued", created_by: user.id, queued_at: new Date().toISOString() }).select().single();
      if (error) return json(req, { error: error.message }, 400);
      const usersResult = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      let users = usersResult.data.users.filter((u) => Boolean(u.email));
      if (sendTo !== "all") {
        const table = sendTo === "subscribers" ? "mtaalam_access_grants" : "mtaalam_purchases";
        let query = admin.from(table).select("user_id");
        query = sendTo === "subscribers" ? query.is("revoked_at", null) : query.eq("status", "approved");
        const { data: eligible } = await query;
        const ids = new Set((eligible ?? []).map((row: any) => row.user_id));
        users = users.filter((u) => ids.has(u.id));
      }
      if (users.length) await admin.from("mtaalam_announcement_recipients").insert(users.map((u) => ({ announcement_id: announcement.id, user_id: u.id, email: u.email })));
      const delivery = await sendAnnouncement(admin, announcement);
      return json(req, { announcement, recipients: users.length, delivery });
    }

    if (action === "admin-upload-url") {
      const body = await req.json();
      const resource = text(body.resource, 20);
      const config = contentConfig(resource);
      const id = uuid(body.id);
      if (!config || !id) return json(req, { error: "Select a content item first." }, 400);
      const { data: existing } = await admin.from(config.table).select("id").eq("id", id).is("deleted_at", null).maybeSingle();
      if (!existing) return json(req, { error: "Content item not found." }, 404);
      const target = uploadTarget(resource, text(body.kind, 20), id, text(body.file_name, 150), text(body.mime, 100), Number(body.size || 0));
      if (!target) return json(req, { error: "This file type or size is not allowed." }, 400);
      const { data, error } = await admin.storage.from(target.bucket).createSignedUploadUrl(target.path, { upsert: false });
      if (error) return json(req, { error: error.message }, 400);
      return json(req, { signed_url: data.signedUrl, path: target.path, bucket: target.bucket, column: target.column });
    }

    if (action === "admin-link-upload") {
      const body = await req.json();
      const resource = text(body.resource, 20);
      const config = contentConfig(resource);
      const id = uuid(body.id);
      const kind = text(body.kind, 20);
      const path = text(body.path, 500);
      const expectedPrefix = kind === "image" ? `images/${resource}/${id}/` : kind === "document" ? `materials/${id}/` : `${resource}s/${id}/`;
      const column = kind === "image" ? (resource === "story" ? "image_url" : "thumbnail_url") : kind === "document" ? "file_path" : "video_path";
      if (!config || !id || !path.startsWith(expectedPrefix) || !config.fields.includes(column) && !["video_path","file_path"].includes(column)) return json(req, { error: "Invalid upload link." }, 400);
      const bucket = kind === "image" ? "mtaalam-public" : "mtaalam-private";
      const { data: objects } = await admin.storage.from(bucket).list(path.slice(0, path.lastIndexOf("/")), { search: path.slice(path.lastIndexOf("/") + 1), limit: 1 });
      if (!objects?.length) return json(req, { error: "Uploaded file was not found." }, 404);
      const value = bucket === "mtaalam-public" ? admin.storage.from(bucket).getPublicUrl(path).data.publicUrl : path;
      const { data, error } = await admin.from(config.table).update({ [column]: value, ...(resource === "story" ? {} : { updated_at: new Date().toISOString() }) }).eq("id", id).select().single();
      if (error) return json(req, { error: error.message }, 400);
      await securityEvent({ user_id: user.id, event_type: "admin_media_uploaded", severity: "low", item_type: resource, item_id: id, summary: `Admin uploaded ${kind} media for ${resource}.` });
      await notifyAdministrators(admin, "Content media uploaded", `A new ${kind} file was uploaded for ${resource} content in Mtaalam Space.`);
      return json(req, { item: data });
    }

    return json(req, { error: "Unknown administrator action." }, 404);
  } catch (error) {
    console.error("mtaalam-api", action, error);
    return json(req, { error: error instanceof Error ? error.message : "Unexpected server error." }, 500);
  }
});
