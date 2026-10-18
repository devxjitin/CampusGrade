import { Children } from "react";

/** Fades its children up one after another (CSS only; honours reduced motion). */
export const Stagger = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={className}>
    {Children.toArray(children).map((child, index) => (
      <div key={index} className="stagger-item h-full" style={{ "--i": index } as React.CSSProperties}>
        {child}
      </div>
    ))}
  </div>
);
