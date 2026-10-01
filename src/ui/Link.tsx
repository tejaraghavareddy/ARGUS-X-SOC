import type { AnchorHTMLAttributes } from 'react';

export function Link({ href, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a href={href} {...rest} />;
}
