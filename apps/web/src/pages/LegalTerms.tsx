import termsMd from "../content/terms.md?raw";
import { LegalDocument } from "../components/Legal/LegalDocument";

export default function LegalTerms(): JSX.Element {
  return <LegalDocument source={termsMd} />;
}
