import { requirePortalCustomer } from "@/lib/portal-session";
import { formatWhatsAppPhone } from "@/lib/whatsapp-templates";

export const metadata = { title: "Support" };

export default async function PortalSupportPage() {
  const me = await requirePortalCustomer();
  const wa = me.firm.phone ? formatWhatsAppPhone(me.firm.phone) : "";
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Contact {me.firm.name}</h1>
      {me.firm.phone ? <p className="text-sm">Phone: <a className="text-primary underline" href={`tel:${me.firm.phone}`}>{me.firm.phone}</a></p> : null}
      {me.firm.email ? <p className="text-sm">Email: <a className="text-primary underline" href={`mailto:${me.firm.email}`}>{me.firm.email}</a></p> : null}
      {wa ? <p className="text-sm"><a className="text-primary underline" href={`https://wa.me/${wa}`}>Chat on WhatsApp</a></p> : null}
      {!me.firm.phone && !me.firm.email ? <p className="text-sm text-muted-foreground">Please contact the shop directly.</p> : null}
    </div>
  );
}
