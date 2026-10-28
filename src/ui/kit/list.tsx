// Grouped list (artboard Components "List cells"; Settings, Saved, Explore directory): a rounded
// surface with separators, optionally under an uppercase section title. A cell is a link (internal
// via next/link; external with rel="noopener noreferrer" and opened in a new tab), a button, or
// static text. Links and buttons show the chevron; rows are 60 px (compact: 50 px).

import "./styles";

import Link from "next/link";
import { useId, type ReactNode } from "react";

export function ListChevron() {
  return (
    <svg className="pn-cell__chevron" width="10" height="16" viewBox="0 0 10 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2 2l6 6-6 6" />
    </svg>
  );
}

type GroupProps = {
  /** Section title above the group; without one, give the list a `label`. */
  title?: string;
  label?: string;
  ordered?: boolean;
  children: ReactNode;
  testId?: string;
};

export function ListGroup({ title, label, ordered = false, children, testId }: GroupProps) {
  const id = useId();
  const List = ordered ? "ol" : "ul";
  if (!title) {
    return (
      <List className="pn-group" aria-label={label} data-testid={testId}>
        {children}
      </List>
    );
  }
  return (
    <section className="pn-section" aria-labelledby={id}>
      <h2 id={id} className="pn-section__title">
        {title}
      </h2>
      <List className="pn-group" data-testid={testId}>
        {children}
      </List>
    </section>
  );
}

type CellBase = {
  title: ReactNode;
  sub?: ReactNode;
  /** "gold" for mapped-candidate subs (Components: "Mapped candidate · not yet verified"). */
  subTone?: "gold";
  icon?: ReactNode;
  /** Leading content rendered as is, without the icon wrapper (a route chip). */
  lead?: ReactNode;
  /** Status badges under the title and sub (Explore directory rows). */
  badges?: ReactNode;
  /** Short value on the right ("Regular", "English"). */
  trailing?: ReactNode;
  compact?: boolean;
  /** next/link prefetch; false for links that would reveal what was typed in a filter box. */
  prefetch?: boolean;
  testId?: string;
};

type CellProps = CellBase &
  (
    | { href: string; onClick?: never; chevron?: boolean }
    | { onClick: () => void; href?: never; chevron?: boolean }
    | { href?: never; onClick?: never; chevron?: never }
  );

const isExternal = (href: string) => /^https?:\/\//.test(href);

export function ListCell(props: CellProps) {
  const { title, sub, subTone, icon, lead, badges, trailing, compact, prefetch, testId } = props;
  const className = compact ? "pn-cell pn-cell--compact" : "pn-cell";
  const actionable = props.href !== undefined || props.onClick !== undefined;
  const body = (
    <>
      {icon ? <span className="pn-cell__icon">{icon}</span> : null}
      {lead ?? null}
      <span className="pn-cell__text">
        <span className="pn-cell__title">{title}</span>
        {sub ? <span className={subTone === "gold" ? "pn-cell__sub pn-cell__sub--gold" : "pn-cell__sub"}>{sub}</span> : null}
        {badges ? <span className="pn-cell__badges">{badges}</span> : null}
      </span>
      {trailing ? <span className="pn-cell__trailing">{trailing}</span> : null}
      {actionable && props.chevron !== false ? <ListChevron /> : null}
    </>
  );

  let cell: ReactNode;
  if (props.href !== undefined) {
    cell = isExternal(props.href) ? (
      <a href={props.href} className={className} target="_blank" rel="noopener noreferrer" data-testid={testId}>
        {body}
      </a>
    ) : (
      <Link href={props.href} prefetch={prefetch === false ? false : undefined} className={className} data-testid={testId}>
        {body}
      </Link>
    );
  } else if (props.onClick !== undefined) {
    cell = (
      <button type="button" className={className} onClick={props.onClick} data-testid={testId}>
        {body}
      </button>
    );
  } else {
    cell = (
      <div className={className} data-testid={testId}>
        {body}
      </div>
    );
  }
  return <li>{cell}</li>;
}
