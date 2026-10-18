-- Una agenda nueva hereda la cualificación del contacto si llega sin respuestas propias.
--
-- Caso: la persona rellena el formulario de cualificación (Typeform) y DESPUÉS agenda. La agenda se
-- crea desde varios sitios (webhook de Calendly, webhook de GHL, sync por pull, alta manual) y solo
-- Calendly sabía arrastrar la cualificación previa. Un trigger cubre todos los caminos a la vez y no
-- depende de que cada uno se acuerde.
--
-- Solo rellena un hueco: si la agenda ya trae sus respuestas (las de Calendly al reservar), no se toca.
-- SECURITY INVOKER (por defecto): lee `contacts` con los permisos de quien inserta, igual que el resto.
CREATE OR REPLACE FUNCTION public.appointments_heredar_cualificacion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  q jsonb;
BEGIN
  IF NEW.contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.qualification IS NOT NULL
     AND jsonb_typeof(NEW.qualification -> 'respuestas') = 'array'
     AND jsonb_array_length(NEW.qualification -> 'respuestas') > 0 THEN
    RETURN NEW;
  END IF;

  SELECT c.qualification INTO q
  FROM public.contacts c
  WHERE c.id = NEW.contact_id AND c.tenant_id = NEW.tenant_id;

  IF q IS NOT NULL
     AND jsonb_typeof(q -> 'respuestas') = 'array'
     AND jsonb_array_length(q -> 'respuestas') > 0 THEN
    NEW.qualification := q;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS appointments_heredar_cualificacion ON public.appointments;
CREATE TRIGGER appointments_heredar_cualificacion
  BEFORE INSERT ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.appointments_heredar_cualificacion();
