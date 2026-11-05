"use client";
import NextLink from "next/link";
import type { ComponentProps } from "react";
import { isWorkspacePath, navigateWorkspace } from "@/lib/workspace-navigation";

/** Keep native new-tab/copy-link behavior; only internal workspace views are shallow. */
export default function WorkspaceLink(props: ComponentProps<typeof NextLink>) {
  const { href, onNavigate, ...rest } = props;
  return (
    <NextLink
      {...rest}
      href={href}
      prefetch={false}
      onNavigate={(event) => {
        let prevented = false;
        onNavigate?.({
          preventDefault: () => {
            prevented = true;
            event.preventDefault();
          },
        });
        if (prevented || typeof href !== "string") return;
        const target = new URL(href, window.location.origin);
        if (
          target.origin === window.location.origin &&
          isWorkspacePath(target.pathname)
        ) {
          event.preventDefault();
          navigateWorkspace(href, !!props.replace);
        }
      }}
    />
  );
}
