import { SystemStateScreen } from "@/components/system-state-screen";

export default function NotFound() {
  return (
    <SystemStateScreen
      eyebrow="Page not found"
      title="There’s nothing to study here."
      description="This address does not point to a YOVA page. Return home to continue your plan, start a session, or ask YOVA for help."
      documentTitle="YOVA · Page not found"
    />
  );
}
