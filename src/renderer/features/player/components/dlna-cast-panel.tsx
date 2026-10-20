import { useTranslation } from 'react-i18next';

import { DeviceList } from '/@/renderer/features/player/components/dlna/device-list';
import { GroupBuilder } from '/@/renderer/features/player/components/dlna/group-builder';
import { SpeakerPropertiesButton } from '/@/renderer/features/player/components/dlna/speaker-properties-button';
import { isSonosDevice, useDlnaCast } from '/@/renderer/features/player/hooks/use-dlna-cast';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { AppIcon } from '/@/shared/components/icon/icon';
import { Paper } from '/@/shared/components/paper/paper';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Text } from '/@/shared/components/text/text';

/** The DLNA cast panel, inside the player bar's More menu (F1); its state is useDlnaCast's. */
export const DlnaCastPanel = ({
    connectedDeviceName,
    coordinatorRef,
    devices,
    expandGroupDevices,
    groupMemberList,
    handleDisconnect,
    handleDiscover,
    handleExpandGroupConfirm,
    handleGroupConfirm,
    handleRemoveMember,
    handleSelect,
    hasSonosDevices,
    isLoading,
    isShiftDown,
    screen,
    setScreen,
}: ReturnType<typeof useDlnaCast>) => {
    const { t } = useTranslation();

    return (
        <Paper p="md" radius="md">
            {screen === 'connecting' && (
                <Group p="sm">
                    <Spinner size="sm" />
                    <Text c="dimmed">{t('dlna.connecting')}</Text>
                </Group>
            )}
            {screen === 'group-build' && (
                <GroupBuilder
                    devices={devices}
                    isLoading={isLoading}
                    onCancel={() => setScreen('idle')}
                    onConfirm={handleGroupConfirm}
                    onRefresh={handleDiscover}
                />
            )}
            {screen === 'expand-group' && coordinatorRef.current && (
                <GroupBuilder
                    devices={expandGroupDevices}
                    isLoading={isLoading}
                    lockedCoordinator={coordinatorRef.current}
                    onCancel={() => setScreen(groupMemberList.length > 1 ? 'group' : 'connected')}
                    onConfirm={handleExpandGroupConfirm}
                    onRefresh={handleDiscover}
                />
            )}
            {screen === 'idle' && (
                <>
                    <Text fw="600" pb="md" size="sm" ta="center">
                        {t('dlna.devices')}
                    </Text>
                    {devices
                        .filter((d) => d.groupMembers && d.groupMembers.length > 1)
                        .map((groupDevice) => (
                            <div
                                key={groupDevice.id}
                                onClick={() => void handleSelect(groupDevice)}
                                style={{
                                    borderRadius: 6,
                                    cursor: 'pointer',
                                    marginBottom: 4,
                                    padding: '8px 10px',
                                }}
                            >
                                <Text fw={600} size="sm">
                                    {groupDevice.name}
                                </Text>
                                {groupDevice.groupMembers!.map((m) => (
                                    <Text
                                        c="dimmed"
                                        fw={m.id === groupDevice.id ? 700 : 400}
                                        key={m.id}
                                        size="xs"
                                        style={{ paddingLeft: 8 }}
                                    >
                                        {m.name}
                                    </Text>
                                ))}
                            </div>
                        ))}
                    <DeviceList
                        devices={devices.filter(
                            (d) => !d.groupMembers || d.groupMembers.length <= 1,
                        )}
                        isLoading={isLoading}
                        onSelect={handleSelect}
                        showEmptyState={devices.length === 0}
                    />
                    {!isLoading && (
                        <Group gap="xs" mt="sm">
                            <Button
                                flex={hasSonosDevices && devices.length >= 2 ? 1 : undefined}
                                fullWidth={!hasSonosDevices || devices.length < 2}
                                leftSection={<AppIcon.refresh size={12} />}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    void handleDiscover();
                                }}
                                size="xs"
                                variant="outline"
                            >
                                {t('dlna.group.refresh')}
                            </Button>
                            {hasSonosDevices && devices.length >= 2 && (
                                <Button
                                    flex={1}
                                    leftSection={<AppIcon.group size={12} />}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setScreen('group-build');
                                    }}
                                    size="xs"
                                    variant="outline"
                                >
                                    {t('dlna.createGroup')}
                                </Button>
                            )}
                        </Group>
                    )}
                </>
            )}
            {screen === 'connected' && (
                <>
                    <Text fw="600" pb="md" size="sm" ta="center">
                        {t('dlna.nowCasting')}
                    </Text>

                    <Group justify="space-between">
                        <Text c="dimmed" size="sm">
                            {connectedDeviceName}
                        </Text>
                        {coordinatorRef.current && isSonosDevice(coordinatorRef.current) && (
                            <SpeakerPropertiesButton
                                deviceId={coordinatorRef.current.id}
                                deviceName={coordinatorRef.current.name}
                            />
                        )}
                    </Group>
                    <Group gap="xs" mt="sm">
                        {coordinatorRef.current && isSonosDevice(coordinatorRef.current) && (
                            <Button
                                flex={1}
                                leftSection={<AppIcon.group size={12} />}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setScreen('expand-group');
                                    void handleDiscover();
                                }}
                                size="xs"
                                variant="outline"
                            >
                                {t('dlna.group.addToGroup')}
                            </Button>
                        )}
                        <Button
                            color={isShiftDown ? 'white' : 'red'}
                            flex={1}
                            onClick={handleDisconnect}
                            size="xs"
                            style={{
                                color: isShiftDown ? undefined : 'var(--theme-colors-state-error)',
                            }}
                            variant="outline"
                        >
                            {t('dlna.disconnect')}
                        </Button>
                    </Group>
                    <Text
                        c="dimmed"
                        mt={6}
                        size="xs"
                        style={{
                            opacity: isShiftDown ? 0 : 1,
                            textAlign: 'center',
                            transition: 'opacity 150ms',
                        }}
                    >
                        {t('dlna.shiftDisconnectHint')}
                    </Text>
                </>
            )}
            {screen === 'group' && (
                <>
                    <Text fw="600" pb="md" size="sm" ta="center">
                        {t('dlna.group.title', { count: groupMemberList.length })}
                    </Text>

                    {groupMemberList.map((member) => (
                        <Group justify="space-between" key={member.device.id} px="sm" py={4}>
                            <Group>
                                <Text c={member.isCoordinator ? 'primary' : undefined} size="sm">
                                    {member.device.name}
                                </Text>
                                {member.isCoordinator && <AppIcon.star size={12} />}
                            </Group>

                            <Group gap="xs">
                                {!member.isCoordinator && !member.device.isPair && (
                                    <Button
                                        color="red"
                                        onClick={() => handleRemoveMember(member.device.id)}
                                        size="compact-xs"
                                        style={{
                                            color: 'var(--theme-colors-state-error)',
                                        }}
                                        variant="subtle"
                                    >
                                        {t('dlna.group.remove')}
                                    </Button>
                                )}
                                {isSonosDevice(member.device) && (
                                    <SpeakerPropertiesButton
                                        deviceId={member.device.id}
                                        deviceName={member.device.name}
                                    />
                                )}
                            </Group>
                        </Group>
                    ))}

                    <Group gap="xs" mt="sm">
                        <Button
                            flex={1}
                            onClick={(e) => {
                                e.stopPropagation();
                                setScreen('expand-group');
                                void handleDiscover();
                            }}
                            size="xs"
                            variant="outline"
                        >
                            {t('dlna.group.addSpeaker')}
                        </Button>
                        <Button
                            color={isShiftDown ? 'white' : 'red'}
                            flex={1}
                            onClick={handleDisconnect}
                            size="xs"
                            style={{
                                color: isShiftDown ? undefined : 'var(--theme-colors-state-error)',
                            }}
                            variant="outline"
                        >
                            {t('dlna.disconnect')}
                        </Button>
                    </Group>
                    <Text
                        c="dimmed"
                        mt={6}
                        size="xs"
                        style={{
                            opacity: isShiftDown ? 0 : 1,
                            textAlign: 'center',
                            transition: 'opacity 150ms',
                        }}
                    >
                        {t('dlna.shiftDisconnectHint')}
                    </Text>
                </>
            )}
        </Paper>
    );
};
