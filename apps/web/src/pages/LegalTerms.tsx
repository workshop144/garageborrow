import termsMd from "../content/terms.md?raw";
import { LegalDocument } from "../components/Legal/LegalDocument";
import { fillTenant } from "../lib/tenant";

export default function LegalTerms(): JSX.Element {
  return <LegalDocument source={fillTenant(termsMd)} />;
}
