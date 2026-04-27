import privacyMd from "../content/privacy.md?raw";
import { LegalDocument } from "../components/Legal/LegalDocument";

export default function LegalPrivacy(): JSX.Element {
  return <LegalDocument source={privacyMd} />;
}
