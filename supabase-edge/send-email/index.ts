// HomeLinq Send Email Edge Function v25 — Updated contact email to sales@homelinq.co.uk
// Deploy: supabase functions deploy send-email --no-verify-jwt
// Env: RESEND_API_KEY must be set in Supabase Edge Function secrets

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = "HomeLinq <noreply@homelinq.co.uk>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const appCtaBlock = `
  <div style="background:linear-gradient(135deg,#0D9488,#0F766E);border-radius:12px;padding:24px;text-align:center;margin:20px 0 0">
    <div style="font-size:28px;margin-bottom:8px">📱</div>
    <div style="color:#fff;font-weight:700;font-size:16px;margin-bottom:8px">Manage Everything from the HomeLinq App</div>
    <div style="color:rgba(255,255,255,.85);font-size:13px;line-height:1.5;margin-bottom:16px">
      View invoices, track certificates, accept quotes, message your engineer, and manage all your gas safety activities — all in one place. No more paperwork.
    </div>
    <a href="https://homelinq.co.uk/app.html#customer" style="display:inline-block;background:#fff;color:#0F766E;font-weight:700;font-size:14px;padding:11px 24px;border-radius:8px;text-decoration:none">
      Open HomeLinq App &rarr;
    </a>
  </div>
`;

function getEmailHtml(type: string, data: any): string {
  const header = `<div style="background:#0D9488;padding:24px;text-align:center">
    <h1 style="color:#fff;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:24px">Home<span style="font-weight:400">Linq</span></h1>
  </div>`;

  const footer = `<div style="padding:24px;text-align:center;color:#94A3B8;font-size:12px;border-top:1px solid #E2E8F0">
    <p style="margin:0 0 8px">HomeLinq — a trading name of Infinite Life Records Ltd</p>
    <p style="margin:0">Trusted Gas Engineer Platform</p>
  </div>`;

  const wrap = (content: string) => `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;margin-top:24px;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,.1)">
    ${header}${content}${footer}</div></body></html>`;

  switch (type) {
    case "engineer_approved":
      return wrap(`
        <div style="padding:32px 24px;text-align:center">
          <div style="font-size:56px;margin-bottom:16px">✅</div>
          <h2 style="color:#0F172A;margin:0 0 8px;font-size:22px">You're Approved!</h2>
          <p style="color:#64748B;font-size:15px;margin:0 0 24px;line-height:1.6">
            Welcome to HomeLinq, <strong style="color:#0F172A">${data.engineer_name || "Engineer"}</strong>!
            Your Gas Safe registration${data.gas_safe_number ? " (No. " + data.gas_safe_number + ")" : ""} has been verified.
          </p>
          <div style="background:#F0FDF4;border:2px solid #10B981;border-radius:12px;padding:20px;margin:0 0 24px;text-align:left">
            <h3 style="color:#059669;margin:0 0 12px;font-size:15px">What you can do now:</h3>
            <p style="color:#1E293B;margin:0 0 8px;font-size:14px">🔧 Accept jobs from the marketplace</p>
            <p style="color:#1E293B;margin:0 0 8px;font-size:14px">📄 Send invoices and quotes to customers</p>
            <p style="color:#1E293B;margin:0 0 8px;font-size:14px">📋 Issue official Gas Safety Certificates</p>
            <p style="color:#1E293B;margin:0 0 8px;font-size:14px">🤖 Use the AI Fault Code Chat assistant</p>
            <p style="color:#1E293B;margin:0;font-size:14px">💰 Get paid directly via Stripe</p>
          </div>
          <a href="${data.login_url || "https://homelinq.co.uk/app.html"}"
             style="display:inline-block;background:#0D9488;color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">
            Log In &amp; Get Started
          </a>
        </div>
      `);

    case "engineer_rejected":
      return wrap(`
        <div style="padding:32px 24px;text-align:center">
          <div style="font-size:56px;margin-bottom:16px">⚠️</div>
          <h2 style="color:#0F172A;margin:0 0 8px;font-size:22px">Application Update</h2>
          <p style="color:#64748B;font-size:15px;margin:0 0 24px;line-height:1.6">
            Hi <strong style="color:#0F172A">${data.engineer_name || "Engineer"}</strong>,
            we were unable to approve your HomeLinq application at this time.
          </p>
          <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:12px;padding:20px;margin:0 0 24px;text-align:left">
            <h3 style="color:#DC2626;margin:0 0 8px;font-size:14px">Reason:</h3>
            <p style="color:#1E293B;margin:0;font-size:14px;line-height:1.5">
              ${data.reason || "We were unable to verify your Gas Safe registration number on the Gas Safe Register."}
            </p>
          </div>
          <div style="background:#F8FAFC;border-radius:12px;padding:20px;margin:0 0 24px;text-align:left">
            <h3 style="color:#0F172A;margin:0 0 8px;font-size:14px">What you can do:</h3>
            <p style="color:#64748B;margin:0;font-size:14px;line-height:1.5">
              If you believe this is an error, please reply to this email or contact us at
              <a href="mailto:${data.support_email || "sales@homelinq.co.uk"}" style="color:#0D9488">${data.support_email || "sales@homelinq.co.uk"}</a>
              with a photo of your Gas Safe ID card. We will review your application again.
            </p>
          </div>
        </div>
      `);

    case "enquiry":
      return wrap(`
        <div style="padding:32px 24px">
          <div style="background:#EFF6FF;border:2px solid #3B82F6;border-radius:12px;padding:16px;margin-bottom:20px">
            <h3 style="color:#1E40AF;margin:0 0 4px;font-size:14px">New Website Enquiry</h3>
            <p style="color:#64748B;margin:0;font-size:13px">Submitted ${data.submitted_at || "just now"}</p>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:10px 12px;font-weight:700;color:#64748B;width:120px;vertical-align:top">Name</td><td style="padding:10px 12px;color:#1E293B">${data.name || "—"}</td></tr>
            <tr style="background:#F8FAFC"><td style="padding:10px 12px;font-weight:700;color:#64748B;vertical-align:top">Email</td><td style="padding:10px 12px;color:#1E293B"><a href="mailto:${data.email || ""}" style="color:#0D9488">${data.email || "—"}</a></td></tr>
            <tr><td style="padding:10px 12px;font-weight:700;color:#64748B;vertical-align:top">Phone</td><td style="padding:10px 12px;color:#1E293B">${data.phone || "Not provided"}</td></tr>
            <tr style="background:#F8FAFC"><td style="padding:10px 12px;font-weight:700;color:#64748B;vertical-align:top">Type</td><td style="padding:10px 12px;color:#1E293B">${data.enquiry_type || "Not specified"}</td></tr>
            <tr><td style="padding:10px 12px;font-weight:700;color:#64748B;vertical-align:top">Message</td><td style="padding:10px 12px;color:#1E293B;line-height:1.5">${(data.message || "—").replace(/\n/g, "<br>")}</td></tr>
          </table>
          <div style="margin-top:20px;padding:16px;background:#F0FDF4;border-radius:8px;font-size:13px;color:#065F46">
            Reply directly to <strong>${data.email || "the sender"}</strong> from your email client.
          </div>
        </div>
      `);

    case "enquiry_confirmation":
      return wrap(`
        <div style="padding:32px 24px">
          <h2 style="color:#0F172A;margin:0 0 12px;font-size:22px">We've received your enquiry</h2>
          <p style="color:#64748B;font-size:15px;line-height:1.6;margin-bottom:20px">
            Hi <strong>${data.name || "there"}</strong>, thanks for reaching out to HomeLinq. Our team will review your ${data.enquiry_type || "enquiry"} and get back to you within 24 hours.
          </p>
          <div style="background:linear-gradient(135deg,#0D9488,#0F766E);border-radius:12px;padding:24px;text-align:center;margin-bottom:20px">
            <div style="font-size:28px;margin-bottom:8px">📱</div>
            <div style="color:#fff;font-weight:700;font-size:17px;margin-bottom:8px">Track Your Request in Real-Time</div>
            <div style="color:rgba(255,255,255,.85);font-size:14px;line-height:1.5;margin-bottom:16px">
              Get instant updates from your engineer, view quotes, manage bookings, and access your gas safety certificates — all in one place.
            </div>
            <a href="https://homelinq.co.uk/app.html#customer" style="display:inline-block;background:#fff;color:#0F766E;font-weight:700;font-size:15px;padding:12px 28px;border-radius:8px;text-decoration:none">
              Open HomeLinq App &rarr;
            </a>
          </div>
          <div style="background:#F8FAFC;border-radius:8px;padding:16px;font-size:13px;color:#64748B;line-height:1.5">
            <strong style="color:#0F172A">What happens next?</strong><br>
            A qualified Gas Safe registered engineer will be in touch to discuss your requirements and arrange a convenient time.
          </div>
        </div>
      `);

    case "booking_confirmation":
      return wrap(`
        <div style="padding:32px 24px">
          <div style="text-align:center;margin-bottom:24px">
            <div style="font-size:48px;margin-bottom:8px">📅</div>
            <h2 style="color:#0F172A;margin:0 0 8px;font-size:22px">Booking Confirmed</h2>
          </div>
          <p style="color:#64748B;font-size:15px;line-height:1.6">
            Hi <strong>${data.customer_name || "there"}</strong>, your booking with <strong>${data.engineer_name || "your engineer"}</strong> has been confirmed.
          </p>
          <div style="background:#F0FDF4;border:2px solid #10B981;border-radius:12px;padding:20px;margin:16px 0">
            ${data.job_type ? `<p style="color:#1E293B;margin:0 0 8px;font-size:14px"><strong>Job:</strong> ${data.job_type}</p>` : ""}
            ${data.date ? `<p style="color:#1E293B;margin:0 0 8px;font-size:14px"><strong>Date:</strong> ${data.date}</p>` : ""}
            ${data.time ? `<p style="color:#1E293B;margin:0 0 8px;font-size:14px"><strong>${data.time.includes("-") ? "Arrival Window:" : "Time:"}</strong> ${data.time}</p>` : ""}
            ${data.address ? `<p style="color:#1E293B;margin:0 0 8px;font-size:14px"><strong>Address:</strong> ${data.address}</p>` : ""}
          </div>
          <p style="color:#64748B;font-size:14px;line-height:1.6">
            Your engineer will notify you when they are on the way. You can track updates in real time through the HomeLinq app.
          </p>
          ${data.gas_safe ? `<p style="color:#9CA3AF;font-size:12px;margin:8px 0 0">Gas Safe Reg: ${data.gas_safe}</p>` : ""}
          ${appCtaBlock}
        </div>
      `);

    case "job_started":
      return wrap(`
        <div style="padding:32px 24px">
          <div style="text-align:center;margin-bottom:24px">
            <div style="font-size:48px;margin-bottom:8px">🚐</div>
            <h2 style="color:#0F172A;margin:0 0 8px;font-size:22px">Your Engineer is On the Way</h2>
          </div>
          <p style="color:#64748B;font-size:15px;line-height:1.6">
            Hi <strong>${data.customer_name || "there"}</strong>, great news — <strong>${data.engineer_name || "your engineer"}</strong> has started your job and is heading to your property now.
          </p>
          <div style="background:#EFF6FF;border:2px solid #3B82F6;border-radius:12px;padding:20px;margin:16px 0">
            ${data.job_type ? `<p style="color:#1E293B;margin:0 0 8px;font-size:14px"><strong>Job:</strong> ${data.job_type}</p>` : ""}
            ${data.address ? `<p style="color:#1E293B;margin:0 0 8px;font-size:14px"><strong>Address:</strong> ${data.address}</p>` : ""}
            ${data.engineer_phone ? `<p style="color:#1E293B;margin:0;font-size:14px"><strong>Contact:</strong> <a href="tel:${data.engineer_phone}" style="color:#0D9488">${data.engineer_phone}</a></p>` : ""}
          </div>
          <p style="color:#64748B;font-size:14px;line-height:1.6">
            Please make sure someone is available at the property to let the engineer in. If you need to get in touch, you can call or message your engineer directly.
          </p>
          <div style="text-align:center;margin-top:20px">
            <a href="https://homelinq.co.uk/app.html#customer" style="display:inline-block;background:#0D9488;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">
              Track Live in App
            </a>
          </div>
        </div>
      `);

    case "job_completed":
      return wrap(`
        <div style="padding:32px 24px">
          <div style="text-align:center;margin-bottom:24px">
            <div style="font-size:48px;margin-bottom:8px">✅</div>
            <h2 style="color:#0F172A;margin:0 0 8px;font-size:22px">Job Complete</h2>
          </div>
          <p style="color:#64748B;font-size:15px;line-height:1.6">
            Hi <strong>${data.customer_name || "there"}</strong>, <strong>${data.engineer_name || "your engineer"}</strong> has completed your job.
          </p>
          <div style="background:#F0FDF4;border:2px solid #10B981;border-radius:12px;padding:20px;margin:16px 0">
            ${data.job_type ? `<p style="color:#1E293B;margin:0 0 8px;font-size:14px"><strong>Job:</strong> ${data.job_type}</p>` : ""}
            ${data.address ? `<p style="color:#1E293B;margin:0 0 8px;font-size:14px"><strong>Address:</strong> ${data.address}</p>` : ""}
            ${data.invoice_id ? `<p style="color:#1E293B;margin:0 0 8px;font-size:14px"><strong>Invoice:</strong> ${data.invoice_id}</p>` : ""}
            ${data.total ? `<p style="color:#0D9488;margin:0;font-size:18px;font-weight:700"><strong>Total: ${data.total}</strong></p>` : ""}
          </div>
          <p style="color:#64748B;font-size:14px;line-height:1.6">
            An invoice has been sent to your email. Your boiler passport and service history have been updated automatically. If you have any questions about the work, you can message your engineer directly through the app.
          </p>
          ${appCtaBlock}
        </div>
      `);

    case "invoice":
      return wrap(`
        <div style="padding:32px 24px">
          <div style="text-align:center;margin-bottom:24px">
            <div style="font-size:48px;margin-bottom:8px">📄</div>
            <h2 style="color:#0F172A;margin:0 0 8px;font-size:22px">Invoice ${data.invoice_id || ""}</h2>
          </div>
          <p style="color:#64748B;font-size:15px;line-height:1.6">
            Hi <strong>${data.customer_name || "Customer"}</strong>, here is your invoice from <strong>${data.engineer_name || "your engineer"}</strong>.
          </p>
          <div style="background:#F8FAFC;border:2px solid #E2E8F0;border-radius:12px;padding:20px;margin:16px 0">
            <p style="color:#1E293B;margin:0 0 8px;font-size:14px"><strong>Description:</strong> ${data.description || "Gas engineer services"}</p>
            <p style="color:#1E293B;margin:0 0 8px;font-size:14px"><strong>Amount:</strong> £${data.amount || "0.00"}</p>
            ${data.vat_inclusive ? `<p style="color:#1E293B;margin:0 0 8px;font-size:14px"><strong>VAT (20%):</strong> £${data.vat || "0.00"}</p>` : ""}
            ${data.vat_number ? `<p style="color:#64748B;margin:0 0 8px;font-size:12px">VAT Reg: ${data.vat_number}</p>` : ""}
            <div style="border-top:2px solid #0D9488;margin-top:12px;padding-top:12px">
              <p style="margin:0;font-size:20px;font-weight:800;color:#0D9488">Total: £${data.total || "0.00"}</p>
            </div>
          </div>
          <p style="color:#64748B;font-size:14px;line-height:1.6">
            You can view and pay this invoice directly from the HomeLinq app. If you have any questions, message your engineer through the app.
          </p>
          ${appCtaBlock}
        </div>
      `);

    case "invoice_reminder":
      return wrap(`
        <div style="padding:32px 24px">
          <div style="text-align:center;margin-bottom:24px">
            <div style="font-size:48px;margin-bottom:8px">📨</div>
            <h2 style="color:#0F172A;margin:0 0 8px;font-size:22px">Payment Reminder</h2>
          </div>
          <p style="color:#64748B;font-size:15px;line-height:1.6">
            Hi <strong>${data.customer_name || "Customer"}</strong>, this is a friendly reminder that invoice <strong>${data.invoice_id || ""}</strong> from <strong>${data.engineer_name || "your engineer"}</strong> is still outstanding.
          </p>
          <div style="background:#FEF3C7;border:2px solid #F59E0B;border-radius:12px;padding:20px;margin:16px 0">
            <p style="color:#1E293B;margin:0 0 8px;font-size:14px"><strong>Invoice:</strong> ${data.invoice_id || ""}</p>
            <p style="color:#1E293B;margin:0 0 8px;font-size:14px"><strong>Description:</strong> ${data.description || "Gas engineer services"}</p>
            <p style="color:#92400E;margin:0;font-size:18px;font-weight:700"><strong>Amount Due: £${data.total || "0.00"}</strong></p>
          </div>
          <p style="color:#64748B;font-size:14px;line-height:1.6">
            ${data.days_overdue ? `This invoice is now <strong>${data.days_overdue} days</strong> past the issue date. ` : ""}Please arrange payment at your earliest convenience. If you have already paid, please disregard this reminder.
          </p>
          ${appCtaBlock}
        </div>
      `);

    case "quote":
      return wrap(`
        <div style="padding:32px 24px">
          <div style="text-align:center;margin-bottom:24px">
            <div style="font-size:48px;margin-bottom:8px">📝</div>
            <h2 style="color:#0F172A;margin:0 0 8px;font-size:22px">New Quote from ${data.engineer_name || "Your Engineer"}</h2>
            ${data.quote_number ? `<p style="color:#64748B;margin:0;font-size:13px">Ref: ${data.quote_number}</p>` : ""}
          </div>
          <p style="color:#64748B;font-size:15px;line-height:1.6">
            Hi <strong>${data.customer_name || "there"}</strong>, you have received a new quote for <strong>${data.original_job || data.description || "gas engineer services"}</strong>.
          </p>
          ${data.address ? `<p style="color:#64748B;font-size:14px;margin:0 0 16px"><strong style="color:#1E293B">Property:</strong> ${data.address}</p>` : ""}
          ${data.diagnosis ? `
          <div style="background:#EFF6FF;border:2px solid #3B82F6;border-radius:12px;padding:16px;margin:0 0 16px">
            <p style="color:#1E40AF;margin:0 0 4px;font-size:12px;font-weight:700">🔍 ENGINEER'S DIAGNOSIS</p>
            <p style="color:#1E293B;margin:0;font-size:14px;line-height:1.5">${data.diagnosis}</p>
          </div>` : ""}
          ${data.parts_description ? `
          <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:16px;margin:0 0 16px">
            <p style="color:#64748B;margin:0 0 4px;font-size:12px;font-weight:700">🔧 PARTS NEEDED</p>
            <p style="color:#1E293B;margin:0;font-size:14px;line-height:1.5">${data.parts_description}</p>
          </div>` : ""}
          <div style="background:#FFFBEB;border:2px solid #F59E0B;border-radius:12px;padding:20px;margin:0 0 16px">
            <p style="color:#92400E;margin:0 0 12px;font-size:13px;font-weight:700">💰 QUOTE BREAKDOWN</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              ${data.parts_cost && parseFloat(data.parts_cost) > 0 ? `<tr><td style="padding:6px 0;color:#1E293B">Parts</td><td style="padding:6px 0;text-align:right;color:#1E293B;font-weight:600">£${data.parts_cost}</td></tr>` : ""}
              ${data.labour_cost && parseFloat(data.labour_cost) > 0 ? `<tr><td style="padding:6px 0;color:#1E293B">Labour</td><td style="padding:6px 0;text-align:right;color:#1E293B;font-weight:600">£${data.labour_cost}</td></tr>` : ""}
              <tr style="border-top:2px solid #F59E0B"><td style="padding:10px 0;font-weight:800;color:#92400E;font-size:16px">Total</td><td style="padding:10px 0;text-align:right;font-weight:800;color:#92400E;font-size:22px">£${data.amount || "0.00"}</td></tr>
            </table>
          </div>
          ${data.available_slots ? `
          <div style="background:#F0FDF4;border:1px solid #10B981;border-radius:12px;padding:16px;margin:0 0 16px">
            <p style="color:#065F46;margin:0 0 6px;font-size:12px;font-weight:700">📅 AVAILABLE TIME SLOTS</p>
            <p style="color:#1E293B;margin:0;font-size:14px;line-height:1.6">${data.available_slots}</p>
          </div>` : ""}
          ${data.expiry_date ? `<p style="color:#9CA3AF;font-size:12px;margin:0 0 8px">⏰ This quote is valid until ${data.expiry_date}</p>` : ""}
          ${data.gas_safe ? `<p style="color:#9CA3AF;font-size:12px;margin:0 0 16px">Gas Safe Reg: ${data.gas_safe}</p>` : ""}
          <p style="color:#64748B;font-size:14px;line-height:1.6">
            Open the HomeLinq app to see the full details, choose a time slot that works for you, and accept or decline the quote.
          </p>
          ${appCtaBlock}
        </div>
      `);

    case "certificate":
      return wrap(`
        <div style="padding:32px 24px">
          <div style="text-align:center;margin-bottom:24px">
            <div style="font-size:48px;margin-bottom:8px">📋</div>
            <h2 style="color:#0F172A;margin:0 0 8px;font-size:22px">Gas Safety Certificate</h2>
          </div>
          <p style="color:#64748B;font-size:15px;line-height:1.6">
            Hi <strong>${data.recipient_name || "there"}</strong>, your ${data.cert_type || "Gas Safety Certificate"} from <strong>${data.engineer_name || "your engineer"}</strong>${data.engineer_business ? " (" + data.engineer_business + ")" : ""} is ready.
          </p>
          <div style="background:#F0FDF4;border:2px solid #10B981;border-radius:12px;padding:20px;margin:16px 0">
            <p style="color:#1E293B;margin:0 0 8px;font-size:14px"><strong>Certificate:</strong> ${data.cert_id || ""}</p>
            <p style="color:#1E293B;margin:0 0 8px;font-size:14px"><strong>Property:</strong> ${data.property || ""}</p>
            <p style="color:#1E293B;margin:0 0 8px;font-size:14px"><strong>Result:</strong> <span style="color:${data.result === "PASS" || data.result === "Pass" ? "#10B981" : "#EF4444"};font-weight:700">${data.result || "PASS"}</span></p>
            <p style="color:#1E293B;margin:0 0 8px;font-size:14px"><strong>Inspection Date:</strong> ${data.date || ""}</p>
            <p style="color:#1E293B;margin:0;font-size:14px"><strong>Next Due:</strong> ${data.expiry || ""}</p>
            ${data.gas_safe ? `<p style="color:#64748B;margin:8px 0 0;font-size:12px">Gas Safe Reg: ${data.gas_safe}</p>` : ""}
          </div>
          <p style="color:#64748B;font-size:14px;line-height:1.6">
            This certificate is a legal document required by your landlord and insurance provider. Keep it safe — you can always access it from the HomeLinq app.
          </p>
          ${appCtaBlock}
        </div>
      `);

    default:
      return wrap(`
        <div style="padding:32px 24px">
          <h2 style="color:#0F172A;margin:0 0 16px">${data.subject || "Notification"}</h2>
          <p style="color:#64748B;font-size:15px;line-height:1.6">${data.message || data.body || "You have a new notification from HomeLinq."}</p>
        </div>
      `);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { to, subject, type, data, reply_to, from_name } = await req.json();

    if (!to || !subject) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing 'to' or 'subject'" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: "RESEND_API_KEY not configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    const html = getEmailHtml(type || "generic", data || {});
    const fromField = from_name ? `${from_name} via HomeLinq <noreply@homelinq.co.uk>` : FROM_EMAIL;

    const emailPayload: any = {
      from: fromField,
      to: [to],
      subject: subject,
      html: html,
    };
    if (reply_to) emailPayload.reply_to = reply_to;
    if (type === "enquiry" && data && data.email) emailPayload.reply_to = data.email;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify(emailPayload),
    });

    const result = await res.json();

    if (!res.ok) {
      return new Response(
        JSON.stringify({ success: false, error: result.message || "Resend error" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    return new Response(
      JSON.stringify({ success: true, id: result.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
