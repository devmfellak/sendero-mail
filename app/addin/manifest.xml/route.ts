import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * The add-in manifest, generated for this deployment's origin so the same
 * build can be installed against staging and production without editing XML.
 *
 * XML (add-in only) manifest rather than the unified JSON one: it installs on
 * every Outlook that runs web add-ins today — classic and new Outlook for
 * Windows, Mac, and Outlook on the web — and through the admin centre's
 * "Upload custom apps" without a Teams app package.
 */
export function GET(): Response {
  const e = env()
  const origin = e.APP_ORIGIN.replace(/\/$/, '')
  const host = new URL(origin).host
  const clientId = e.MS_CLIENT_ID ?? '00000000-0000-0000-0000-000000000000'
  const id = 'b7d3c3a2-5e1f-4f38-9b8e-3a5c0d8e51a7'

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0"
           xmlns:mailappor="http://schemas.microsoft.com/office/mailappversionoverrides/1.0"
           xsi:type="MailApp">
  <Id>${id}</Id>
  <Version>0.8.0.0</Version>
  <ProviderName>Sendero</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="Sendero">
    <Override Locale="es-ES" Value="Sendero" />
  </DisplayName>
  <Description DefaultValue="Triage and bilingual reply drafts for the message you are reading.">
    <Override Locale="es-ES" Value="Clasificación y borradores de respuesta bilingües para el mensaje que está leyendo." />
  </Description>
  <IconUrl DefaultValue="${origin}/addin/icon-64.png" />
  <HighResolutionIconUrl DefaultValue="${origin}/addin/icon-128.png" />
  <SupportUrl DefaultValue="${origin}/addin" />
  <AppDomains>
    <AppDomain>${origin}</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Mailbox" />
  </Hosts>
  <Requirements>
    <Sets>
      <Set Name="Mailbox" MinVersion="1.5" />
    </Sets>
  </Requirements>
  <FormSettings>
    <Form xsi:type="ItemRead">
      <DesktopSettings>
        <SourceLocation DefaultValue="${origin}/addin/taskpane" />
        <RequestedHeight>450</RequestedHeight>
      </DesktopSettings>
    </Form>
  </FormSettings>
  <Permissions>ReadItem</Permissions>
  <Rule xsi:type="RuleCollection" Mode="Or">
    <Rule xsi:type="ItemIs" ItemType="Message" FormType="Read" />
  </Rule>
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/mailappversionoverrides" xsi:type="VersionOverridesV1_0">
    <VersionOverrides xmlns="http://schemas.microsoft.com/office/mailappversionoverrides/1.1" xsi:type="VersionOverridesV1_1">
      <Requirements>
        <bt:Sets DefaultMinVersion="1.5">
          <bt:Set Name="Mailbox" />
        </bt:Sets>
      </Requirements>
      <Hosts>
        <Host xsi:type="MailHost">
          <DesktopFormFactor>
            <ExtensionPoint xsi:type="MessageReadCommandSurface">
              <OfficeTab id="TabDefault">
                <Group id="sendero.group">
                  <Label resid="groupLabel" />
                  <Control xsi:type="Button" id="sendero.open">
                    <Label resid="buttonLabel" />
                    <Supertip>
                      <Title resid="buttonLabel" />
                      <Description resid="buttonTip" />
                    </Supertip>
                    <Icon>
                      <bt:Image size="16" resid="icon16" />
                      <bt:Image size="32" resid="icon32" />
                      <bt:Image size="80" resid="icon80" />
                    </Icon>
                    <Action xsi:type="ShowTaskpane">
                      <SourceLocation resid="taskpaneUrl" />
                      <SupportsPinning>true</SupportsPinning>
                    </Action>
                  </Control>
                </Group>
              </OfficeTab>
            </ExtensionPoint>
          </DesktopFormFactor>
        </Host>
      </Hosts>
      <Resources>
        <bt:Images>
          <bt:Image id="icon16" DefaultValue="${origin}/addin/icon-16.png" />
          <bt:Image id="icon32" DefaultValue="${origin}/addin/icon-32.png" />
          <bt:Image id="icon80" DefaultValue="${origin}/addin/icon-80.png" />
        </bt:Images>
        <bt:Urls>
          <bt:Url id="taskpaneUrl" DefaultValue="${origin}/addin/taskpane" />
        </bt:Urls>
        <bt:ShortStrings>
          <bt:String id="groupLabel" DefaultValue="Sendero" />
          <bt:String id="buttonLabel" DefaultValue="Triage &amp; reply">
            <bt:Override Locale="es-ES" Value="Clasificar y responder" />
          </bt:String>
        </bt:ShortStrings>
        <bt:LongStrings>
          <bt:String id="buttonTip" DefaultValue="See priority, a summary and a suggested reply in English or Spanish.">
            <bt:Override Locale="es-ES" Value="Vea la prioridad, un resumen y una respuesta sugerida en español o inglés." />
          </bt:String>
        </bt:LongStrings>
      </Resources>
      <WebApplicationInfo>
        <Id>${clientId}</Id>
        <Resource>api://${host}/${clientId}</Resource>
        <Scopes>
          <Scope>openid</Scope>
          <Scope>profile</Scope>
        </Scopes>
      </WebApplicationInfo>
    </VersionOverrides>
  </VersionOverrides>
</OfficeApp>
`
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sendero-outlook-manifest.xml"',
    },
  })
}
