import { createClient } from "@supabase/supabase-js";

// Make sure to pull env vars manually or run via `bun run ...` which loads .env automatically
const supabaseUrl = process.env.SUPABASE_URL || "https://dibbawbvzrcodipbwdfn.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing supabase URL or Key in environment variables.");
    process.exit(1);
}

const db = createClient(supabaseUrl, supabaseKey);

const TEMPLATE_BODY = `<p>Dear {name},</p>
<p>Congratulations - you&#39;ve been selected to join the <span style="color:#c62828;font-weight:700;">5th Hack-Nation Global AI Hackathon</span>, hosted in collaboration with the <strong>MIT Sloan AI Club</strong>, taking place April 25-26, 2026, <strong>both virtually and in person at several local hubs</strong>.</p>
<p><strong>Start: April 25, 11:00 AM Boston time (ET)</strong><br/>
Local meetups will begin earlier so participants can get to know each other before the kick-off.<br/>
<strong>Agenda:</strong> <a href="http://hack-nation.ai">hack-nation.ai</a><br/>
<strong>Info slide deck:</strong> <a href="https://docs.google.com/presentation/d/1h4KUEFSUm1FSdWRYI-7Er022F2qYx5JW/edit?slide=id.p4#slide=id.p4">Download the slide deck</a><br/>
<strong>Local hubs:</strong> MIT, Stanford, Oxford, ETH Zurich, Munich, and more.<br/>
We&#39;ll share the finalized hub list and instructions on how to join in the next email.<br/>
<strong>On April 10,</strong> we will send out confirmations indicating whether we can offer you an in-person spot at one of our hubs or whether you will be waitlisted for the hub.<br/>
<strong>In any case, you are already accepted to participate online</strong>, so you will definitely be able to join the hackathon.<br/>
<strong>Zoom link for the kick-off:</strong> will be sent shortly before the event via email.</p>
<p><strong>Three actions required:</strong></p>
<ol>
<li><strong>Please RSVP on Luma by Sunday, March 15, to secure your spot:</strong> <a href="https://luma.com/7v8s6xlw?coupon=0LPLM2">RSVP on Luma</a>.<br/>
When registering, please use your <strong>private access code: 0LPLM2</strong>.<br/>
<em>Please keep this code private and do not share it with others.</em></li>
<li><strong>Download</strong> the image to share and celebrate your acceptance <strong>on social media</strong>. Tag us on <a href="https://www.linkedin.com/company/hack-nation">LinkedIn</a> or <a href="https://www.instagram.com/hacknation.globalai/">Instagram</a>.</li>
<li><strong>Refer</strong> cracked AI builders - your referral code: <strong>Hack-with-Linn-5174</strong>.</li>
</ol>
<p><strong>What&#39;s at stake:</strong></p>
<ul>
<li><strong>$30k+ in API credits and cash prizes.</strong></li>
<li><strong>$150k+ API credits available during Hack.</strong></li>
<li>Winning teams may be selected for the <strong>venture track</strong> to launch their AI startup, run in collaboration with EWOR, one of Europe&#39;s leading startup builders.</li>
</ul>
<p><strong>No idea is required beforehand - the AI challenges will be revealed on hackathon day.</strong> We&#39;ll send more details soon about keynotes, challenge tracks, and how to make the most of the experience.</p>
<p>Have an amazing week and see you soon!</p>
<p>Linn &amp; the Hack-Nation Team</p>
<p>--<br/>
Linn Bieske<br/>
MIT Leaders for Global Operations (LGO) Fellow<br/>
MBA/MS Electrical Engineering &amp; Computer Science<br/>
Mobile: +1 857 867 0556<br/>
<a href="mailto:lbieske@mit.edu">lbieske@mit.edu</a><br/>
<a href="https://www.linkedin.com/in/linn-bieske-189b9b138/">LinkedIn</a></p>`;

async function run() {
    const { data: existing, error: err1 } = await db
        .from("message_templates")
        .select("id, name")
        .eq("org_id", 1)
        .like("name", "sys-comms-plan:accepted:%")
        .limit(1)
        .maybeSingle();

    const nameStr = "sys-comms-plan:accepted:1a Accepted";
    const subjectStr = "Congratulations - You're In! | 5th Hack-Nation Global AI Hackathon";
    const tags = ["system:comms-plan", "sys-comms-plan:accepted"];

    if (existing) {
        console.log("Updating existing template ID:", existing.id);
        const { error } = await db.from("message_templates").update({ body: TEMPLATE_BODY, subject: subjectStr, name: nameStr, tags }).eq("id", existing.id);
        if (error) console.error("Update error:", error);
    } else {
        console.log("Inserting new template");
        const { error } = await db.from("message_templates").insert({
            name: nameStr,
            type: "EMAIL",
            subject: subjectStr,
            body: TEMPLATE_BODY,
            org_id: 1,
            user_id: "system",
            attachments: [],
            tags: tags,
        });
        if (error) console.error("Insert error:", error);
    }
    console.log("Done");
}

run();
