"use client";

/**
 * Editor rich text (TipTap) para "Especificaciones / Descripción del producto".
 * SOLO se usa en administración (nunca en la web pública). Emite HTML; la
 * sanitización autoritativa es server-side (processRichText). El toolbar se
 * limita a: negrita, cursiva, H2, H3, viñetas, numeradas, enlace, deshacer/rehacer.
 */
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { useEffect } from "react";

function Btn({
  editor,
  onClick,
  active,
  label,
  title,
}: {
  editor: Editor;
  onClick: () => void;
  active?: boolean;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`h-8 min-w-8 px-2 rounded text-sm font-semibold border transition ${
        active ? "bg-[#021F5F] text-white border-[#021F5F]" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
      }`}
    >
      {label}
    </button>
  );
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const editor = useEditor({
    immediatelyRender: false, // evita hydration mismatch en Next
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,
        code: false,
        blockquote: false,
        horizontalRule: false,
        strike: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: false,
        protocols: ["http", "https", "mailto"],
        HTMLAttributes: { rel: "nofollow noopener noreferrer", target: "_blank" },
      }),
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class:
          "rte-content min-h-[160px] max-h-[420px] overflow-auto rounded-b-md border border-t-0 border-gray-300 p-3 focus:outline-none prose prose-sm max-w-none",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Sincroniza cambios externos del value (ej. init legacy plano→HTML seguro).
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  if (!editor) return null;

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL del enlace (http/https/mailto):", prev ?? "https://");
    if (url === null) return;
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    if (!/^(https?:|mailto:)/i.test(url.trim())) {
      window.alert("Solo se permiten enlaces http, https o mailto.");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  return (
    <div className="rte">
      <div className="flex flex-wrap gap-1 rounded-t-md border border-gray-300 bg-gray-50 p-1.5">
        <Btn editor={editor} title="Negrita" label="B" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} />
        <Btn editor={editor} title="Cursiva" label="I" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <Btn editor={editor} title="Título" label="H2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <Btn editor={editor} title="Subtítulo" label="H3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
        <Btn editor={editor} title="Lista con viñetas" label="•" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <Btn editor={editor} title="Lista numerada" label="1." active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        <Btn editor={editor} title="Enlace" label="🔗" active={editor.isActive("link")} onClick={setLink} />
        <span className="mx-1 w-px self-stretch bg-gray-300" />
        <Btn editor={editor} title="Deshacer" label="Deshacer" onClick={() => editor.chain().focus().undo().run()} />
        <Btn editor={editor} title="Rehacer" label="Rehacer" onClick={() => editor.chain().focus().redo().run()} />
      </div>
      <EditorContent editor={editor} />
      {placeholder && !value ? (
        <p className="mt-1 text-xs text-gray-400">{placeholder}</p>
      ) : null}
    </div>
  );
}
