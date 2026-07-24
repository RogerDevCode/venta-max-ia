DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cart WHERE status='active'
    GROUP BY organization_id,conversation_id HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'commerce preflight: duplicate active carts';
  END IF;
  IF EXISTS (
    SELECT 1 FROM cart c
    CROSS JOIN LATERAL jsonb_array_elements(c.items) item
    WHERE NOT (item ? 'productId')
      OR NOT (item ? 'quantity')
      OR (item->>'quantity') !~ '^[1-9][0-9]*$'
  ) THEN
    RAISE EXCEPTION 'commerce preflight: invalid legacy cart item';
  END IF;
END $$;
--> statement-breakpoint
ANALYZE cart;
--> statement-breakpoint
ANALYZE "order";
