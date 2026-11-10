import { type ReactNode } from 'react';
import { DragDropProvider } from '@dnd-kit/react';
import { isSortable, useSortable } from '@dnd-kit/react/sortable';
import {
  Feedback,
  KeyboardSensor,
  PointerActivationConstraints,
  PointerSensor,
} from '@dnd-kit/dom';
import { AppIcon } from './icon-markup.js';

export function moveCard(keys: string[], from: string, to: string) {
  const result = [...keys],
    start = result.indexOf(from),
    end = result.indexOf(to);
  if (start < 0 || end < 0 || start === end) return result;
  result.splice(start, 1);
  result.splice(end, 0, from);
  return result;
}

type CardItem = { id: string; name: string; content: (handle: ReactNode) => ReactNode };
const transition = { duration: 220, easing: 'cubic-bezier(0.25, 1, 0.5, 1)', idle: true };
const feedback = Feedback.configure({
  feedback: 'clone',
  rootElement: (source) => source.element?.closest('dialog') || document.body,
  dropAnimation: transition,
});
const sensors = [
  PointerSensor.configure({
    activationConstraints: (event) =>
      event.pointerType === 'mouse'
        ? [new PointerActivationConstraints.Distance({ value: 5 })]
        : [new PointerActivationConstraints.Delay({ value: 250, tolerance: 8 })],
  }),
  KeyboardSensor,
];

const sortablePlugins: NonNullable<Parameters<typeof useSortable>[0]['plugins']> = (defaults) => [
  ...defaults,
  feedback,
];

function SortableCard({
  item,
  index,
  disabled,
}: {
  item: CardItem;
  index: number;
  disabled: boolean;
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: item.id,
    index,
    disabled,
    transition,
    plugins: sortablePlugins,
  });
  return (
    <div
      ref={ref}
      className="sortable-card"
      role="listitem"
      data-sortable-id={item.id}
      data-dragging={isDragging || undefined}
    >
      {item.content(
        <button
          ref={handleRef}
          type="button"
          className="icon-button sortable-card-handle"
          draggable={false}
          disabled={disabled}
          aria-label={'拖动排序 ' + item.name}
          title="拖动排序；键盘按空格开始，方向键移动，回车确认，Esc 取消"
          onDragStart={(e) => e.preventDefault()}
        >
          <AppIcon name="grip" />
        </button>,
      )}
    </div>
  );
}

/** dnd-kit owns gesture detection and animated feedback; persistence happens only after drop. */
export function SortableCards({
  items,
  onMove,
  disabled = false,
}: {
  items: CardItem[];
  onMove: (from: string, to: string) => void;
  disabled?: boolean;
}) {
  return (
    <DragDropProvider
      sensors={sensors}
      onDragEnd={(event) => {
        if (event.canceled || disabled || !event.operation.target) return;
        const { source } = event.operation;
        if (!isSortable(source)) return;
        const { initialIndex, index } = source;
        const from = items[initialIndex],
          to = items[index];
        if (from && to && from.id === source.id && from.id !== to.id) onMove(from.id, to.id);
      }}
    >
      <div className="cards" role="list" aria-label="模板排序">
        {items.map((item, index) => (
          <SortableCard key={item.id} item={item} index={index} disabled={disabled} />
        ))}
      </div>
    </DragDropProvider>
  );
}
