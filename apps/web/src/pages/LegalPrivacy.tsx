import privacyMd from "../content/privacy.md?raw";
import { LegalDocument } from "../components/Legal/LegalDocument";
import { fillTenant } from "../lib/tenant";

export default function LegalPrivacy(): JSX.Element {
  return <LegalDocument source={fillTenant(privacyMd)} />;
}
