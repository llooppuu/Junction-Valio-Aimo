import { FileSignature, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { verifyOffer, type SignedOffer as Offer, type VerifyResult } from "../lib/api";
import { formatTime } from "../lib/format";
import { useI18n } from "../lib/i18n";

/** Changes the price in the token's payload but keeps the signature, the way a tampering client would. */
function tamperWithPrice(token: string): string {
  const [header, payload, signature] = token.split(".");
  const json = JSON.parse(atob(payload!.replace(/-/g, "+").replace(/_/g, "/")));
  json.pricePerPackageEurCents = 1;
  const forged = btoa(JSON.stringify(json)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${header}.${forged}.${signature}`;
}

type CheckState = { kind: "genuine" | "tampered"; result: VerifyResult } | { kind: "error"; message: string } | null;

/**
 * The trust protocol made visible: every offer is signed by the server, and
 * anyone can check it. "Tamper" edits the price inside the token and shows the
 * server refusing it.
 */
export function SignedOfferBadge({ offer }: { offer: Offer }) {
  const { t } = useI18n();
  const [state, setState] = useState<CheckState>(null);
  const [busy, setBusy] = useState(false);

  async function check(kind: "genuine" | "tampered") {
    setBusy(true);
    try {
      const result = await verifyOffer(kind === "genuine" ? offer.token : tamperWithPrice(offer.token));
      setState({ kind, result });
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : t("offer.failed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signed-offer">
      <p className="signed-offer-line">
        <FileSignature aria-hidden="true" size={15} />
        <span>{t("offer.signedUntil", { time: formatTime(offer.expiresAt) })}</span>
        <button type="button" className="button-link" disabled={busy} onClick={() => void check("genuine")}>
          {t("offer.verify")}
        </button>
        <button type="button" className="button-link signed-offer-tamper" disabled={busy} onClick={() => void check("tampered")}>
          {t("offer.tamper")}
        </button>
      </p>
      {state?.kind === "error" && <p className="agent-error">{state.message}</p>}
      {state && state.kind !== "error" && (
        <p className={`signed-offer-result ${state.result.valid ? "signed-offer-valid" : "signed-offer-invalid"}`} role="status">
          {state.result.valid ? <ShieldCheck aria-hidden="true" size={15} /> : <ShieldAlert aria-hidden="true" size={15} />}
          {state.result.valid
            ? t("offer.valid")
            : `${state.kind === "tampered" ? t("offer.tampered") : ""}${t("offer.refused", { reason: state.result.reason ?? "" })}`}
        </p>
      )}
    </div>
  );
}
