import React, { useRef, useEffect } from "react";
import "./Breadcrumbs.css";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Icon } from "./Icon";

interface BreadcrumbsProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  currentPath,
  onNavigate,
}) => {
  // Normalize path
  const sanitizedPath = currentPath.startsWith("/")
    ? currentPath
    : "/" + currentPath;
  const parts = sanitizedPath.split("/").filter(Boolean);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [currentPath]);

  return (
    <div
      ref={scrollRef}
      onWheel={(e) => {
        if (scrollRef.current) {
          scrollRef.current.scrollLeft += e.deltaY;
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        overflowX: "auto",
        overflowY: "hidden",
        whiteSpace: "nowrap",
        scrollbarWidth: "none",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <IconButton
        variant="standard"
        onClick={() => onNavigate("/")}
        className="breadcrumb-root"
        title="Root"
      >
        <Icon name="home" style={{ fontSize: "18px" }} />
      </IconButton>
      {parts.length === 0 && (
        <span style={{ fontWeight: 600, padding: '0 2px' }}>/</span>
      )}

      {parts.map((p, i) => {
        const path = "/" + parts.slice(0, i + 1).join("/");
        return (
          <React.Fragment key={path}>
            <span className="breadcrumb-separator">/</span>
            <Button
              variant="text"
              onClick={() => onNavigate(path)}
              className="breadcrumb-item"
              style={{ fontWeight: i === parts.length - 1 ? 600 : 400 }}
            >
              {p}
            </Button>
          </React.Fragment>
        );
      })}
    </div>
  );
};
