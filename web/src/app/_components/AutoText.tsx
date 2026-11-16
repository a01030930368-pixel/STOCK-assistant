"use client";
// 한 줄처럼 보이지만 엔터로 줄을 바꿀 수 있는 입력칸. 글이 길어지면 저절로 높아져요.
import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

export default function AutoText(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea rows={1} {...props} ref={ref} className={`autotext ${props.className ?? ""}`.trim()} />;
}
