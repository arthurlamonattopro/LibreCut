import { useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

interface TabListProps {
  /** The tab names, in the order they are shown. */
  tabs: readonly string[];
  /** The tab that is currently open. */
  active: string;
  onChange: (tab: string) => void;
  /** The name of the group of tabs, for a screen reader. */
  label: string;
  /** Prefix for the generated ids that tie a tab to its panel. */
  idPrefix?: string;
  className?: string;
  tabClassName?: (active: boolean) => string;
  renderTab?: (tab: string) => ReactNode;
}

/**
 * A tab list that behaves like the one a person expects.
 *
 * Only the open tab is a tab stop, and the arrow keys move between the
 * tabs. The ids tie each tab to the panel it opens so a screen reader can
 * name the panel it moves into.
 */
export function TabList({
  tabs,
  active,
  onChange,
  label,
  idPrefix = "tab",
  className,
  tabClassName,
  renderTab,
}: TabListProps) {
  const buttons = useRef(new Map<string, HTMLButtonElement | null>());

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, tab: string) => {
    const index = tabs.indexOf(tab);
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const target = tabs[next];
    onChange(target);
    buttons.current.get(target)?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className={className}>
      {tabs.map((tab) => (
        <button
          key={tab}
          role="tab"
          id={`${idPrefix}-tab-${tab}`}
          aria-selected={active === tab}
          aria-controls={`${idPrefix}-panel-${tab}`}
          data-active={active === tab}
          tabIndex={active === tab ? 0 : -1}
          ref={(element) => {
            buttons.current.set(tab, element);
          }}
          className={tabClassName?.(active === tab)}
          onClick={() => onChange(tab)}
          onKeyDown={(event) => onKeyDown(event, tab)}
        >
          {renderTab ? renderTab(tab) : tab}
        </button>
      ))}
    </div>
  );
}

interface TabPanelProps {
  id: string;
  tabId: string;
  children: ReactNode;
  className?: string;
}

/** The panel a tab opens, named by the tab that opens it. */
export function TabPanel({ id, tabId, children, className }: TabPanelProps) {
  return (
    <div role="tabpanel" id={id} aria-labelledby={tabId} className={className}>
      {children}
    </div>
  );
}
