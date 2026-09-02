export function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return <header className="page-header">{eyebrow && <span className="step-label">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</header>;
}
